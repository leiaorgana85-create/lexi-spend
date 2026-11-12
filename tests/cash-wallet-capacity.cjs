const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Sheets mock enforces the real 969-row boundary and checks the append path.
function cashFixture() {
  const rows = Array.from({length:968}, (_, i) =>
    ['2026-10-01',100,'THB',0.03,3,0,0,'','Thailand','','2026-10-01T00:00:00Z','fixture-'+i]);
  let capacity = 969;
  let expansions = 0;
  const sheet = {
    getLastRow: () => rows.length + 1,
    getMaxRows: () => capacity,
    insertRowsAfter(row, count) {
      assert.equal(row, capacity);
      assert.ok(count >= 1);
      capacity += count;
      expansions += 1;
    },
    getRange(r, c, h=1, w=1) {
      assert.ok(r >= 1 && r+h-1 <= capacity, 'Range exceeds grid capacity');
      return {
        getValues() {
          return rows.slice(r-2, r-2+h).map(row => row.slice(c-1, c-1+w));
        },
        createTextFinder(target) {
          return {
            matchEntireCell() { return this; },
            findNext() {
              const i = rows.findIndex(row => String(row[c-1]) === String(target));
              return i < 0 ? null : {getRow: () => i+2};
            }
          };
        },
        setValues(values) {
          assert.equal(values.length, h);
          for(let i=0;i<values.length;i++) {
            assert.equal(values[i].length, w);
            assert.equal(c, 1);
            assert.equal(w, 12);
            rows[r-2+i] = values[i].slice();
          }
        }
      };
    }
  };
  return {sheet, rows, getCapacity:()=>capacity, getExpansions:()=>expansions};
}
const money = x => Math.round((Number(x)+Number.EPSILON)*100)/100;
const data = {entryId:'wallet970test',date:'2026-11-11',amount:100,currency:'THB',
  atmFee:0,bankDebitUsd:'',country:'Thailand',note:'capacity fixture'};
const shared = {
  console, Number, String, Math, Array, Set, Date,
  normalizeIsoDate_: x=>x, normalizeDateCell_: x=>x,
  sheetDateValue_: x=>new Date(x+'T00:00:00Z'),
  canonicalCountryForCurrency_:()=> 'Thailand',
  getUsdRate_:()=>({rate:0.03,source:'fixture',effectiveDate:'2026-11-11'}),
  roundMoney_:money,
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}
};
{
  const f=cashFixture(),context={...shared,
    SUPPORTED_WALLET_CURRENCIES:['THB'],
    validateCashSchema_(){},getCashSheet_:()=>f.sheet};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script-v2-api.gs'),'utf8'),context);
  assert.equal(f.sheet.getLastRow(),969);
  const result=context.v2AddCashWithdrawal_(data);
  assert.equal(result.ok,true);
  assert.equal(result.deduped,false);
  assert.equal(f.rows.length,969);
  assert.equal(f.rows[968][11],'wallet970test');
  assert.equal(f.getCapacity(),1069);
  assert.equal(f.getExpansions(),1);
  const retry=context.v2AddCashWithdrawal_(data);
  assert.equal(retry.deduped,true);
  assert.equal(f.rows.length,969,'Retry appended duplicate cash withdrawal');
  assert.equal(f.getExpansions(),1);
  assert.throws(()=>context.v2AddCashWithdrawal_({...data,amount:101}),/different cash data/);
  console.log('PASS v2 Cash Wallet row 970 capacity growth, retry idempotency and duplicate-data rejection.');
}
{
  const f=cashFixture(), context={...shared,
    Utilities:{getUuid:()=> 'legacy-wallet970',parseDate:(s,tz,fmt)=>new Date(s+'T00:00:00Z'),formatDate:(d,tz,fmt)=>d.toISOString().slice(0,10)},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fixture-spreadsheet'})},
    SpreadsheetApp:{openById:()=>({getSpreadsheetTimeZone:()=> 'UTC'})}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script-code.gs'),'utf8'),context);
  context.normalizeIsoDate_=x=>x;
  context.canonicalCountryForCurrency_=()=> 'Thailand';
  context.getUsdRate_=shared.getUsdRate_;
  context.roundMoney_=money;
  context.getCashSheet_=()=>f.sheet;
  const result=context.addCashWithdrawal(data);
  assert.equal(result.ok,true);
  assert.equal(f.rows.length,969);
  assert.equal(f.rows[968][11],'legacy-wallet970');
  assert.equal(f.getCapacity(),1069);
  assert.equal(f.getExpansions(),1);
  console.log('PASS legacy Cash Wallet row 970 capacity growth.');
}
