const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const code=read('apps-script-code.gs');
const v2=read('apps-script-v2-api.gs');
const manifest=JSON.parse(read('appsscript.json'));
assert.equal(manifest.runtimeVersion,'V8');
assert.equal(manifest.timeZone,'America/New_York');
assert.equal(manifest.webapp.executeAs,'USER_DEPLOYING');
assert.equal(manifest.webapp.access,'ANYONE_ANONYMOUS');
assert.ok(!code.includes("const SPREADSHEET_ID = '"),'Do not commit the private ledger ID to source');
const ledgerId='fixture-ledger-id';
const tx=[
 ['2026-11-11','Shop','Shopping & Others','Card',5,'USD',1,5,'United States','','','','tx1','','',''],
 ['2026-11-11','Food','Food','Card',10,'USD',1,10,'United States','','','','tx2','','',''],
 ['2026-11-11','Medication','GLP-1','Card',70,'USD',1,70,'United States','','','','tx3','','',''],
 ['2026-11-11','Rent','Housing','Card',100,'USD',1,100,'United States','','','','tx4','','',''],
 ['2026-11-11','Legacy','Travel & Irregular','Card',50,'USD',1,50,'United States','','','','tx5','','','']
];
const cash=[
 ['2026-11-10',3000,'THB',.03,90,250,7.42,'','Thailand','','','atm1'],
 ['2026-11-09',1000,'THB',.03,30,10,.30,'','Thailand','','','atm2'],
 ['2026-10-29',1000,'THB',.03,30,80,2.5,'','Thailand','','','atm3']
];
function fakeSheet(ranges,size){
 return {getLastRow:()=>size+1,getMaxColumns:()=>26,getRange(...args){
  const k=args.join(',');
  if(!Object.hasOwn(ranges,k))throw new Error('Unexpected range '+k);
  const rows=ranges[k];return {getValues:()=>rows,getDisplayValues:()=>rows,getValue:()=>rows[0][0]};
 }};
}
const setup=fakeSheet({'B4':[[1515]],'B5':[[30.44]],'D2:F20':[
 ['Food',800,'budgeted'],['Shopping',400,'budgeted'],['Transport',80,'budgeted'],
 ['GLP-1','','no limit']]},20);
const transactions=fakeSheet({'2,1,5,16':tx,'2,1,5,15':tx.map(x=>x.slice(0,15)),
 '1,1,1,15':[['Date','Merchant','Category','Payment Method','Local Amount','Currency','FX Rate to USD','USD Amount','Country','Note','Logged At','FX Source','Entry ID','Receipt Link','Receipt File ID']]},5);
const wallet=fakeSheet({'2,1,3,12':cash,
 '1,1,1,12':[['Date','Cash Received','Currency','Reference FX Rate to USD','Estimated Cash USD','ATM Fee','Estimated ATM Fee USD','Exact Bank USD Debit','Country','Note','Logged At','Entry ID']]},3);
const sheet={getSpreadsheetTimeZone:()=> 'Asia/Bangkok',getSheetByName:n=>({Setup:setup,Transactions:transactions,'Cash Wallet':wallet}[n]||null)};
const opened=[];
const c={console,Date,Number,String,Math,Array,Set,Map,JSON,
 PropertiesService:{getScriptProperties:()=>({getProperty:n=>n==='LEXI_SPEND_SPREADSHEET_ID'?ledgerId:null})},
 SpreadsheetApp:{openById:id=>{opened.push(id);return sheet}},
 Utilities:{
  parseDate:s=>new Date(s+'T00:00:00+07:00'),
  formatDate:(d,tz)=>new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d).split('/').map((x,i,a)=>i===0?a[2]:i===1?a[0].padStart(2,'0'):a[1].padStart(2,'0')).join('-')
 }};
vm.createContext(c);vm.runInContext(code+'\n'+v2,c);
assert.equal(c.canonicalCountryForCurrency_('GTQ','Thailand'),'Guatemala');
assert.equal(c.normalizeCategory_('Shopping & Others'),'Shopping');
assert.ok(vm.runInContext("SUPPORTED_WALLET_CURRENCIES.includes('GTQ') && SUPPORTED_WALLET_CURRENCIES.includes('VND')",c));
const stay={name:'Bangkok',start:'2026-10-24',end:'2027-01-20',status:'active'};
c.stayFixture=stay;
const summary=vm.runInContext("getSpendingSummary_('2026-11-12', undefined, stayFixture)",c);
assert.equal(summary.weeklyTotal,15,'Only budgeted categories count in weekly limit');
assert.equal(summary.monthlyTotal,85,'All regular spend including no-limit GLP-1 stays in monthly total');
assert.equal(summary.budgetTotal,15);
assert.equal(summary.legacyTravelUsd,50);
const month=vm.runInContext("v2GetCalendarMonth_('2026-11')",c);
assert.equal(month.monthTotalUsd,85);
assert.equal(month.monthAtmFeesUsd,7.72,'Selected-month ATM fees are a memo total');
assert.deepEqual(Array.from(month.atmFeeEntries,x=>x.entryId),['atm2','atm1']);
const date=vm.runInContext("sheetDateValue_('2026-11-12')",c);
assert.equal(date.toISOString(),'2026-11-11T17:00:00.000Z');
assert.equal(c.normalizeDateCell_(date),'2026-11-12');
assert.deepEqual(opened,[ledgerId]);
console.log('PASS canonical migration: manifest, sheet ID, GTQ, legacy categories, budget totals, native dates, monthly ATM-fee separation');
