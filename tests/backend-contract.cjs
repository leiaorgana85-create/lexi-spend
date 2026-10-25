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
const spreadsheet = { getSheetByName(name) { assert.equal(name,'Setup');return setup; } };
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
assert.strictEqual(context.v2BudgetConfig_(),config);
assert.equal(reads,1,'Canonical budget cache must be shared');
assert.throws(()=>context.v2LogExpense_({entryId:'fixture01',date:'2026-10-25',today:'2026-10-25',
 merchant:'Fixture',category:'Housing',paymentMethod:'Card',amount:10,currency:'THB'}),/Invalid category/);
console.log('PASS backend contract: all shipped GS dependencies resolve; removed-helper negative control; real canonical budget/category helpers without application mocks.');
