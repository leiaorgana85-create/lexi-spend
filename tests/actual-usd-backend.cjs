const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const rows=[];let header='';let capacity=907;let capacityExpansions=0;
const money=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const sheet={getLastRow:()=>rows.length+1,getMaxRows:()=>capacity,
 insertRowsAfter(row,count){assert.equal(row,capacity);assert.ok(count>=1);capacity+=count;capacityExpansions++;},
 setColumnWidth(){},getRange(r,c,n=1,w=1){assert.ok(r+n-1<=capacity, 'Range exceeds grid capacity');return {
 getValue:()=>header,setValue(v){header=v;return this;},setNote(){return this;},setNumberFormat(){return this;},setBackground(){return this;},
 setFormulas(){},getValues:()=>rows.slice(r-2,r-2+n).map(row=>row.slice(c-1,c-1+w)),
 setValues(values){values.forEach((row,i)=>{rows[r-2+i]=row.slice();});},
 createTextFinder(id){return {matchEntireCell(){return this;},findNext(){const i=rows.findIndex(row=>row[12]===id);return i<0?null:{getRow:()=>i+2};}};}
 };}};
const context={Number,String,Math,Array,Set,Date,console,
 normalizeIsoDate_:x=>x,normalizeDateCell_:x=>x instanceof Date ? x.toISOString().slice(0,10) : x,todayIso_:()=> '2026-10-24',
 canonicalCountryForCurrency_:()=> 'Thailand',normalizeCategory_:x=>x,
 sheetDateValue_:x=>new Date(x+'T00:00:00Z'),
 getBudgetConfig_:()=>({categories:[{name:'Food'}]}),validateTransactionSchema_(){},getSheet_:()=>sheet,
 validateCashSchema_(){},getCashSheet_:()=>({getLastRow:()=>1}),
 roundMoney_:money,getUsdRate_:()=>({rate:.03,source:'reference',effectiveDate:'2026-10-24'}),
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 SpreadsheetApp:{flush(){rows.forEach(row=>{if(typeof row[7]==='string'&&row[7].startsWith('='))row[7]=row[15]===''?money(row[4]*row[6]):money(row[15]);});}},
 getSpendingSummary_:(today,rs)=>({weeklyTotal:money(rs.reduce((sum,row)=>sum+row[7],0))}),
 getCashState_:()=>({balance:100}),getAppState:()=>({recent:[]})
};vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../apps-script-v2-api.gs'),'utf8'),context);
function payload(id,actualUsd){return {entryId:id,date:'2026-10-24',merchant:'Fixture',category:'Food',paymentMethod:'Card',amount:100,currency:'THB',actualUsd};}
for(const [id,value,expected] of [['blank001','',3],['actual01',2.8,2.8],['zero0001',0,0]]){
 const result=context.v2LogExpense_(payload(id,value));assert.equal(result.usdAmount,expected);assert.equal(rows.at(-1)[15],value);assert.equal(rows.at(-1)[7],expected);
 const retry=context.v2LogExpense_(payload(id,value));assert.equal(retry.deduped,true);assert.equal(retry.usdAmount,expected);
}
assert.equal(rows.length,3);assert.equal(header,'Actual USD');
assert.throws(()=>context.v2LogExpense_(payload('actual01',2.7)),/different expense data/);
assert.throws(()=>context.v2LogExpense_(payload('zero0001','')),/different expense data/);
for(const value of [-1,'oops',Infinity])assert.throws(()=>context.v2ActualUsd_(value),/Invalid Actual USD/);
const month=context.v2GetCalendarMonth_('2026-10');assert.equal(month.monthTotalUsd,5.8);assert.equal(month.transactionCount,3);
assert.equal(month.days['2026-10-24'].transactions[1].actualUsd,2.8);
assert.equal(context.v2TransactionReturn_('actual01',2.8,.03,'2026-10-24','2026-10-24','Card','THB',false).summary.weeklyTotal,5.8);
assert.equal(context.v2UsdFormula_(8),'=IF(ISNUMBER(P8),ROUND(P8,2),ROUND(E8*G8,2))');
console.log('PASS Actual USD backend: schema, blank/override/zero, durable rows, retry identity, validation, Calendar and summary totals (simulated Sheets).');

// Legacy Code.gs is still deployed for some users: the newer budget helper is
// absent. Exercise the real write path in that environment, not a stub of it.
const modernBudgetHelper=context.getBudgetConfig_;
delete context.getBudgetConfig_;
let setupReads=0;
context.getSpreadsheet_=()=>({getSheetByName(name){
 assert.equal(name,'Setup');return {getRange(range){
   assert.equal(range,'D2:F20');return {getValues(){setupReads++;return [
     ['Food',800,'budgeted'],['Shopping & Others',400,'budgeted'],
     ['GLP-1','','no limit'],['Housing',0,'excluded'],['',0,'budgeted']
   ];}};
 }};
}});
const legacyPayload=payload('legacy01','');
assert.equal(context.v2LogExpense_(legacyPayload).usdAmount,3);
assert.equal(context.v2LogExpense_(legacyPayload).deduped,true);
assert.equal(rows.filter(row=>row[12]==='legacy01').length,1);
assert.ok(setupReads>=2);
assert.throws(()=>context.v2LogExpense_({...payload('invalid01',''),category:'Housing'}),/Invalid category/);
assert.equal(rows.length,4);
context.getSpreadsheet_=()=>({getSheetByName:()=>null});
assert.throws(()=>context.v2LogExpense_(payload('missing01','')),/Setup sheet not found/);
assert.equal(rows.length,4);
context.getBudgetConfig_=modernBudgetHelper;
assert.equal(context.v2BudgetConfig_().categories[0].name,'Food');
console.log('PASS legacy backend: absent budget helper, Setup categories, real write, retry deduplication and rejected invalid/missing setup without data loss.');


// The real v2 expense writer must grow the sheet when the 908th row is needed.
while(rows.length<906){
  const i=rows.length;
  rows.push(['2026-10-01','Fixture','Food','Card',0,'THB',0.03,0,'Thailand','','2026-10-01T00:00:00Z','reference','fixture-'+i,'','','']);
}
assert.equal(sheet.getLastRow(),907);
const capacitySave=context.v2LogExpense_(payload('capacity908',''));
assert.equal(capacitySave.ok,true);
assert.equal(rows.length,907);
assert.equal(capacity,1007);
assert.equal(capacityExpansions,1);
assert.equal(rows[906][12],'capacity908');
assert.equal(context.v2LogExpense_(payload('capacity908','')).deduped,true);
assert.equal(rows.length,907,'A retry must not append a duplicate after growth');
console.log('PASS v2 Transactions row 908: capacity grows and retry remains idempotent (simulated Sheets).');

// Exercise the real legacy Code.gs logExpense writer, not a substituted app helper.
const legacySource=fs.readFileSync(require('path').join(__dirname,'../apps-script-code.gs'),'utf8');
const legacyRows=Array.from({length:906},(_,i)=>['2026-10-01','Fixture','Food','Card',0,'THB',0.03,0,'Thailand','','','reference','old-'+i,'','']);
let legacyCapacity=907,legacyGrows=0;
const legacySheet={
 getLastRow:()=>legacyRows.length+1,getMaxRows:()=>legacyCapacity,
 insertRowsAfter(row,count){assert.equal(row,legacyCapacity);legacyCapacity+=count;legacyGrows++;},
 getRange(row,col,height,width){assert.ok(row+height-1<=legacyCapacity,'Legacy range exceeds grid capacity');return {
   setValues(values){for(const v of values)legacyRows.push(v);},
   getValues(){return legacyRows.slice(row-2,row-2+height).map(v=>v.slice(col-1,col-1+width));}
 }; }
};
const legacyContext={console,Date,Number,String,Math,Array,
  Utilities:{getUuid:()=> 'legacy-capacity-908',parseDate:(s,tz,fmt)=>new Date(s+'T00:00:00Z'),formatDate:(d,tz,fmt)=>d.toISOString().slice(0,10)},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fixture-spreadsheet'})},
  SpreadsheetApp:{openById:()=>({getSpreadsheetTimeZone:()=> 'UTC'})}
};
vm.createContext(legacyContext);
vm.runInContext(legacySource,legacyContext);
legacyContext.normalizeIsoDate_=x=>x;
legacyContext.todayIso_=()=> '2026-10-24';
legacyContext.canonicalCountryForCurrency_=()=> 'Thailand';
legacyContext.getSheet_=()=>legacySheet;
legacyContext.getUsdRate_=()=>({rate:.03,source:'reference',effectiveDate:'2026-10-24'});
legacyContext.roundMoney_=money;
legacyContext.getRecentTransactions_=()=>[];
legacyContext.getSpendingSummary_=()=>({});
const legacySave=legacyContext.logExpense({date:'2026-10-24',today:'2026-10-24',merchant:'Fixture',category:'Food',paymentMethod:'Card',amount:0,currency:'THB'});
assert.equal(legacySave.ok,true);
assert.equal(legacyRows.length,907);
assert.equal(legacyRows[906][12],'legacy-capacity-908');
assert.equal(legacyCapacity,1007);
assert.equal(legacyGrows,1);
console.log('PASS legacy Code.gs Transactions row 908: capacity grows before write (simulated Sheets).');
