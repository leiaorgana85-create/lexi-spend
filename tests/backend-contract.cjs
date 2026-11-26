const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const scope = require('eslint-scope');
const root = path.resolve(__dirname, '..');
const files = ['apps-script-code.gs', 'apps-script-auth-transfer.gs', 'apps-script-v2-api.gs'];
const source = files.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const standardGlobals = vm.runInNewContext('Object.getOwnPropertyNames(globalThis)');
const gasGlobals = ['SpreadsheetApp','PropertiesService','CacheService','LockService',
  'HtmlService','DriveApp','Utilities','Session','UrlFetchApp','Logger','ScriptApp','MimeType',
  'ContentService','console'];
function unresolved(code) {
  const ast = acorn.parse(code, {ecmaVersion:2022, ranges:true});
  const manager = scope.analyze(ast, {ecmaVersion:2022, sourceType:'script', optimistic:true});
  const allowed = new Set([...standardGlobals, ...gasGlobals]);
  return [...new Set(manager.globalScope.through
    // A guarded optional helper is intentional legacy compatibility.
    .filter(ref => !allowed.has(ref.identifier.name))
    .map(ref => ref.identifier.name))].sort();
}
assert.deepEqual(unresolved(source), [], 'Undefined backend dependencies');
new vm.Script(source); // Also rejects duplicate global lexical declarations.
const ast = acorn.parse(source, {ecmaVersion:2022, ranges:true});
const helper = ast.body.find(node => node.type==='FunctionDeclaration' && node.id.name==='v2BudgetConfig_');
assert.ok(helper);
const broken = source.slice(0, helper.start) + source.slice(helper.end);
assert.ok(unresolved(broken).includes('v2BudgetConfig_'), 'Dependency checker must detect a removed helper');

// Run the actual canonical budget helpers together, without stubbing any
// application function. Only the external Google Sheets service is simulated.
let reads = 0;
const setup = { getRange(range) { return {
  getValue() { return range==='B4' ? 1515 : 30; },
  getValues() { assert.equal(range,'D2:F20'); reads++; return [
    ['Food',800,'budgeted'],['Shopping & Others',400,'budgeted'],
    ['GLP-1','','no limit'],['Housing',0,'excluded']
  ]; }
}; }};
const spreadsheet = { getSpreadsheetTimeZone:()=> 'Etc/UTC', getSheetByName(name) { assert.equal(name,'Setup');return setup; } };
const context = {
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fixture-spreadsheet'})},
  SpreadsheetApp:{openById:()=>spreadsheet},console
};
vm.createContext(context);
vm.runInContext(source,context);
const config = context.v2BudgetConfig_();
assert.equal(config.monthlyBudgetLimit,1515);
assert.deepEqual(Array.from(config.categories,x=>x.name),['Food','Shopping & Others','GLP-1']);
assert.equal(context.normalizeCategory_('shopping and others'),'Shopping & Others');
assert.equal(context.normalizeCategory_('Housing'),'Housing');
assert.equal(context.canonicalCountryForCurrency_('GTQ','Thailand'),'Guatemala',
  'GTQ expense and cash entries must use Guatemala rather than the current stay');
assert.ok(vm.runInContext('SUPPORTED_WALLET_CURRENCIES.includes("GTQ")',context),
  'GTQ cash wallet must be returned by getAppState');
assert.ok(vm.runInContext('SUPPORTED_WALLET_CURRENCIES.includes("VND")',context),
  'existing VND wallet history must remain readable');
assert.strictEqual(context.v2BudgetConfig_(),config);
assert.equal(reads,1,'Canonical budget cache must be shared');
assert.throws(()=>context.v2LogExpense_({entryId:'fixture01',date:'2026-10-25',today:'2026-10-25',
 merchant:'Fixture',category:'Housing',paymentMethod:'Card',amount:10,currency:'THB'}),/Invalid category/);
console.log('PASS backend contract: all shipped GS dependencies resolve; removed-helper negative control; real canonical budget/category helpers without application mocks.');

// Only explicitly authenticated RPC entry points may be public. doGet is a
// data-free HTML bridge; doPost validates the API credential before dispatch.
const publicFunctions = ast.body.filter(n=>n.type==='FunctionDeclaration' && !n.id.name.endsWith('_')).map(n=>n.id.name).sort();
assert.deepEqual(publicFunctions,['authBridgeExecuteSession','authGoogleBootstrap','bridgeExecute','bridgeExecuteV2','doGet','doPost']);
const securityCalls=[];
const expectedCode='synthetic-test-code';
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const securityContext={
  console,
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='LEXI_SPEND_API_CODE_SHA256'?hash(expectedCode):null})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest())},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  HtmlService:{XFrameOptionsMode:{ALLOWALL:'allowall'},createHtmlOutputFromFile:name=>({name,setTitle(){return this;},setXFrameOptionsMode(){return this;}})}
};
vm.createContext(securityContext);vm.runInContext(source,securityContext);
securityContext.previewUsd_= (...args)=>{securityCalls.push(args);return {ok:true};};
for(const router of ['bridgeExecute','bridgeExecuteV2']){
  for(const bad of ['', 'invalid']){
    assert.throws(()=>securityContext[router](bad,'previewUsd',[]),/Missing|Invalid/);
  }
  assert.deepEqual(securityContext[router](expectedCode,'previewUsd',[]),{ok:true});
  assert.throws(()=>securityContext[router](expectedCode,'setupLexiSpendApiCode',[]),/Unsupported/);
}
for(const bad of ['', 'invalid']){
  const response=securityContext.doPost({postData:{contents:JSON.stringify({apiCode:bad,functionName:'previewUsd'})}});
  assert.equal(JSON.parse(response.text).ok,false);
}
assert.throws(()=>securityContext.authBridgeExecuteSession('','previewUsd',[]),/Invalid/);
assert.throws(()=>securityContext.authGoogleBootstrap('','',''),/missing/);
assert.equal(securityContext.doGet().name,'Bridge');
assert.equal(securityCalls.length,2,'Only the two authorized requests may invoke the stub');
const weeklyStay={name:'Fixture',start:'2031-04-24',end:'2031-06-23',status:'active'};
const weeklyRows=[['2031-05-23','Fixture','Food','Card',99,'USD',1,99],['2031-05-24','Fixture','Food','Card',12,'USD',1,12]];
const week= context.getSpendingSummary_('2031-05-24',weeklyRows,weeklyStay);
assert.equal(week.weekStart,'2031-05-24');
assert.equal(week.weekEnd,'2031-05-30');
assert.equal(week.weeklyTotal,12);
console.log('PASS authenticated entry points, rejection and stay-month week isolation');
