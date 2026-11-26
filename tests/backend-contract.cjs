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
  'ContentService','MailApp','console'];
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

// Receipt deletion: exercise real RPC routes and the real shared ancestry guard.
// All Drive and ledger operations below are isolated synthetic service fixtures.
const iterator = items => { let n=0; return {hasNext:()=>n<items.length,next:()=>items[n++]}; };
const folder = (id, parents=[]) => ({getId:()=>id,getParents:()=>iterator(parents)});
const receiptRoot=folder('receipt-root');
const year=folder('year',[receiptRoot]);
const month=folder('month',[year]);
const outside=folder('other-root');
const lookalike=folder('other-month',[outside]);
const loop=folder('loop');
loop.getParents=()=>iterator([loop]);
const trashCalls=[];
let configuredRoot='receipt-root';
const filesById=new Map();
function addFile(id,parents,trashed=false) {
  const file={getParents:()=>iterator(parents),isTrashed:()=>trashed,setTrashed(v){assert.equal(v,true);trashed=true;trashCalls.push(id);}};
  filesById.set(id,file);
  return file;
}
addFile('direct',[receiptRoot]);
addFile('nested',[month]);
addFile('already',[month],true);
addFile('outside',[lookalike]);
addFile('parentless',[]);
addFile('cyclic',[loop]);
addFile('denied',[{getId:()=> 'denied-folder',getParents:()=>{throw new Error('Permission denied');}}]);
addFile('trash-error',[month]).setTrashed=()=>{throw new Error('Trash failed');};
let fileReads=0;
const receiptContext={
  console,
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='LEXI_SPEND_API_CODE_SHA256'?hash(expectedCode):configuredRoot})},
  Utilities:securityContext.Utilities,
  DriveApp:{getFileById:id=>{fileReads++;if(!filesById.has(id))throw new Error('File unavailable');return filesById.get(id);}},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}
};
vm.createContext(receiptContext);vm.runInContext(source,receiptContext);
for(const router of ['bridgeExecute','bridgeExecuteV2']){
  assert.throws(()=>receiptContext[router]('','deleteReceiptFile',['outside']),/Missing|Invalid/);
}
assert.equal(fileReads,0,'Unauthenticated deletion never touches Drive');
assert.equal(receiptContext.bridgeExecute(expectedCode,'deleteReceiptFile',['direct']).ok,true);
assert.equal(receiptContext.bridgeExecuteV2(expectedCode,'deleteReceiptFile',['nested']).alreadyMissing,false);
assert.equal(receiptContext.bridgeExecuteV2(expectedCode,'deleteReceiptFile',['nested']).alreadyMissing,true);
assert.equal(receiptContext.bridgeExecuteV2(expectedCode,'deleteReceiptFile',['already']).alreadyMissing,true);
assert.equal(receiptContext.bridgeExecuteV2(expectedCode,'deleteReceiptFile',['']).alreadyMissing,true);
for(const router of ['bridgeExecute','bridgeExecuteV2']){
  for(const id of ['outside','parentless','cyclic']){
    assert.throws(()=>receiptContext[router](expectedCode,'deleteReceiptFile',[id]),/outside the configured receipt folder/);
  }
  assert.throws(()=>receiptContext[router](expectedCode,'deleteReceiptFile',['denied']),/Permission denied/);
  assert.throws(()=>receiptContext[router](expectedCode,'deleteReceiptFile',['unknown']),/File unavailable/);
  assert.throws(()=>receiptContext[router](expectedCode,'deleteReceiptFile',['trash-error']),/Trash failed/);
}
configuredRoot='';
assert.throws(()=>receiptContext.bridgeExecuteV2(expectedCode,'deleteReceiptFile',['outside']),/receipt folder is not configured/);
configuredRoot='receipt-root';
assert.deepEqual(trashCalls,['direct','nested']);
// Exercise V2 expense deletion and cleanup without real ledger writes. Stub
// the unchanged legacy ledger operation and its read model, not the guard.
let currentRow=null;
let ledgerDeletes=0;
receiptContext.getSheet_=()=>({
  getLastRow:()=>currentRow?2:1,
  getRange(row,col){return col===13?{createTextFinder:()=>({matchEntireCell:()=>({findNext:()=>currentRow?{getRow:()=>2}:null})})}:{getValues:()=>[currentRow]};}
});
receiptContext.deleteExpense_=()=>{currentRow=null;ledgerDeletes++;return {ok:true,recent:[],summary:{}};};
receiptContext.getRecentTransactions_=()=>[];
receiptContext.getSpendingSummary_=()=>({});
function deleteFixture(fileId){
  currentRow=Array(16).fill('');currentRow[14]=fileId;
  return receiptContext.bridgeExecuteV2(expectedCode,'deleteExpense',['fixture123','2031-05-24']);
}
addFile('expense-receipt',[month]);
assert.equal(deleteFixture('expense-receipt').receiptDeleted,true);
const blocked=deleteFixture('outside');
assert.equal(blocked.ok,true);
assert.equal(blocked.receiptDeleted,false);
assert.match(blocked.receiptCleanupWarning,/cleanup needs review/);
assert.equal(deleteFixture('unknown').receiptDeleted,false);
assert.equal(deleteFixture('').ok,true);
assert.equal(ledgerDeletes,4);
assert.deepEqual(trashCalls,['direct','nested','expense-receipt']);
assert.equal(receiptContext.bridgeExecuteV2(expectedCode,'deleteExpense',['fixture123','2031-05-24']).alreadyDeleted,true);
console.log('PASS receipt folder scope: both RPC paths, nested receipts, retries, missing configuration, Drive failures, and transaction cleanup isolation');

// Daily health email — actual production functions, only Google services mocked.
const healthProps=new Map();
let healthNow=new Date('2031-02-01T01:05:00Z'), healthZone='Asia/Bangkok';
let healthRows=[['Overview','Value'],['DATA CHECKS',''],['Integrity',0],['Open placeholders (info)',2],['Other check',0],['','']];
let healthSent=[], healthReads=0, healthReleased=0, healthTriggers=[];
const healthClock=(now,zone)=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {day:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)};
};
const healthOverview={getLastRow:()=>healthRows.length,getRange:()=>({getValues:()=>{healthReads++;return healthRows},getDisplayValues:()=>healthRows.map(r=>r.map(String))})};
const healthContext={
  console,
  Date:class extends Date{constructor(...args){super(...(args.length?args:[healthNow.getTime()]));}},
  Utilities:{formatDate:(now,zone,fmt)=>fmt==='HH'?String(healthClock(now,zone).hour).padStart(2,'0'):healthClock(now,zone).day},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>healthProps.get(k)||null,setProperty:(k,v)=>healthProps.set(k,v)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{healthReleased++;}})},
  Session:{getEffectiveUser:()=>({getEmail:()=> 'owner@example.invalid'})},
  MailApp:{getRemainingDailyQuota:()=>1,sendEmail:(...args)=>healthSent.push(args)},
  SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='FLIGHT_LEGS'?{}:null})},
  ScriptApp:{getProjectTriggers:()=>healthTriggers,newTrigger:n=>({timeBased:()=>({everyHours:h=>({create:()=>{assert.equal(h,1);healthTriggers.push({getHandlerFunction:()=>n});}})})}),deleteTrigger:t=>{healthTriggers=healthTriggers.filter(x=>x!==t)}}
};
vm.createContext(healthContext);vm.runInContext(source,healthContext);
healthContext.getSpreadsheet_=()=>({getSheetByName:n=>n==='Overview'?healthOverview:null});
healthContext.healthReadZone_=()=>healthZone;
const tick=()=>healthContext.lexiSpendHealthEmail_();
tick();assert.equal(healthReads,1);assert.equal(healthSent.length,0,'Healthy day including info count must not send');
healthRows[2][1]=4;tick();assert.equal(healthReads,1,'One check per local day');
healthNow=new Date('2031-02-02T01:07:00Z');tick();tick();
assert.equal(healthSent.length,1);assert.equal(healthSent[0][0],'owner@example.invalid');assert.equal(healthSent[0][2],'Integrity: 4');
healthNow=new Date('2031-02-03T00:00:00Z');tick();assert.equal(healthSent.length,1,'Before 08:00 local');
healthZone='America/Guatemala';healthNow=new Date('2031-02-03T14:10:00Z');healthRows[4][1]='#REF!';tick();
assert.equal(healthSent.length,2);assert.equal(healthSent[1][2],'Integrity: 4\nOther check: #REF!');
healthZone='Asia/Bangkok';healthNow=new Date('2031-02-03T01:00:00Z');tick();assert.equal(healthSent.length,2,'Cross-zone same date must not duplicate');
assert.ok(healthReleased>=6);
assert.throws(()=>healthContext.healthIssues_([['bad',0]],[['bad','0']]),/missing/);
assert.throws(()=>healthContext.healthIssues_([['DATA CHECKS',''],['Open placeholders (info)',2]],[['DATA CHECKS',''],['Open placeholders (info)','2']]),/empty/);
assert.equal(healthContext.healthZoneValid_('Not/AZone'),false);
const stay=(name,date,zone)=>[name,date,'','','','','','',zone];
const leg=(id,day,dep,arrday,arr,status,from,to)=>[id,1,'','',day,dep,'',arrday,arr,'','','','',status,from,to];
const stays=[stay('First','2031-02-01','Asia/Bangkok'),stay('Second','2031-02-10','America/Guatemala')];
const legs=[leg('fixture-trip','2031-02-10','9:00 AM','2031-02-10','1:00 PM','Booked','Asia/Bangkok','America/Los_Angeles'),leg('fixture-next','2031-02-11','8:00 AM','2031-02-11','2:00 PM','Booked','America/Los_Angeles','America/Guatemala')];
const stamps={'2031-02-10 9:00 AM':Date.parse('2031-02-10T02:00:00Z'),'2031-02-10 1:00 PM':Date.parse('2031-02-10T21:00:00Z'),'2031-02-11 8:00 AM':Date.parse('2031-02-11T16:00:00Z'),'2031-02-11 2:00 PM':Date.parse('2031-02-11T20:00:00Z')};
const zoneAt=(iso,l=legs)=>healthContext.healthSelectZone_(new Date(iso),stays,l,'Asia/Bangkok',healthClock,(d,t)=>stamps[d+' '+t]);
assert.equal(zoneAt('2031-02-10T03:00:00Z'),'Asia/Bangkok');
assert.equal(zoneAt('2031-02-10T22:00:00Z'),'America/Los_Angeles');
assert.equal(zoneAt('2031-02-11T19:00:00Z'),'America/Los_Angeles');
assert.equal(zoneAt('2031-02-11T21:00:00Z'),'America/Guatemala');
assert.equal(zoneAt('2031-02-12T14:00:00Z',[]),'America/Guatemala');
assert.throws(()=>healthContext.installLexiSpendHealthEmail_(),/Travel sheet ID/);
healthProps.set('LEXI_SPEND_HEALTH_TRAVEL_ID','synthetic-private-id');
healthContext.installLexiSpendHealthEmail_();healthContext.installLexiSpendHealthEmail_();
assert.equal(healthTriggers.length,1,'Installation idempotent');
assert.equal(healthSent.length,2,'Installation must send no email');
console.log('PASS health email: local morning, transit zones, daily dedupe, zero/info silence, issues and errors, owner-only recipient, idempotent install.');

