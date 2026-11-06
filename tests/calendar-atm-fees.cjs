const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const backend = ['apps-script-code.gs', 'apps-script-v2-api.gs']
  .map(file => fs.readFileSync(file, 'utf8')).join('\n');
const cashHeaders = [
  'Date','Cash Received','Currency','Reference FX Rate to USD',
  'Estimated Cash USD','ATM Fee','Estimated ATM Fee USD',
  'Exact Bank USD Debit','Country','Note','Logged At','Entry ID'
];
function cashRow(date, fee, feeUsd, entryId) {
  return [date, 1000, 'THB', .03, 30, fee, feeUsd, '', 'Thailand', '', '', entryId];
}
const cashRows = [
  cashRow('2030-03-10', 120, 3.4, 'fixture-a'),
  cashRow('2030-03-11', 140, 3.65, 'fixture-b'),
  cashRow('2030-04-01', 160, 4.2, 'fixture-c')
];
function sheet(headers, rows) {
  return {
    getMaxColumns: () => 26,
    getLastRow: () => rows.length + 1,
    getRange: (first, column, count) => {
      if (first === 1) return {getDisplayValues: () => [headers]};
      assert.equal(first, 2);
      assert.equal(count, rows.length);
      return {getValues: () => rows};
    }
  };
}
const context = {
  PropertiesService: {getScriptProperties: () => ({getProperty: () => 'fixture-id'})},
  SpreadsheetApp: {openById: () => spreadsheet},
  console
};
vm.createContext(context);
vm.runInContext(backend, context);
const headers = vm.runInContext('TRANSACTION_HEADERS', context);
const tabs = {
  Transactions: sheet(Array.from(headers), []),
  'Cash Wallet': sheet(cashHeaders, cashRows)
};
const spreadsheet = {
  getSheetByName: name => tabs[name],
  getSpreadsheetTimeZone: () => 'Asia/Bangkok'
};

const march = context.v2GetCalendarMonth_('2030-03');
assert.equal(march.monthAtmFeesUsd, 7.05);
assert.equal(march.atmFeeEntries.length, 2);
assert.deepEqual(Array.from(march.atmFeeEntries, r => r.date), ['2030-03-10', '2030-03-11']);
assert.equal(march.monthTotalUsd, 0, 'Withdrawals and ATM fees must not inflate expenses');
assert.equal(march.transactionCount, 0);
assert.equal(Object.keys(march.days).length, 0);
const april = context.v2GetCalendarMonth_('2030-04');
assert.equal(april.monthAtmFeesUsd, 4.2);
assert.equal(april.atmFeeEntries.length, 1);
const feb = context.v2GetCalendarMonth_('2030-02');
assert.equal(feb.monthAtmFeesUsd, 0);
assert.equal(feb.atmFeeEntries.length, 0);
console.log('PASS calendar ATM fees: selected-month isolation and expense-total separation.');
