const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const rows=[];let header='';
const money=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const sheet={getLastRow:()=>rows.length+1,getMaxRows:()=>907,setColumnWidth(){},getRange(r,c,n=1,w=1){return {
 getValue:()=>header,setValue(v){header=v;return this;},setNote(){return this;},setNumberFormat(){return this;},setBackground(){return this;},
 setFormulas(){},getValues:()=>rows.slice(r-2,r-2+n).map(row=>row.slice(c-1,c-1+w)),
 setValues(values){values.forEach((row,i)=>{rows[r-2+i]=row.slice();});},
 createTextFinder(id){return {matchEntireCell(){return this;},findNext(){const i=rows.findIndex(row=>row[12]===id);return i<0?null:{getRow:()=>i+2};}};}
 };}};
const context={Number,String,Math,Array,Set,Date,console,
 normalizeIsoDate_:x=>x,normalizeDateCell_:x=>x,todayIso_:()=> '2026-10-24',
 canonicalCountryForCurrency_:()=> 'Thailand',normalizeCategory_:x=>x,
 getBudgetConfig_:()=>({categories:[{name:'Food'}]}),validateTransactionSchema_(){},getSheet_:()=>sheet,
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
