const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

class Element {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.listeners = {};
    this.className = '';
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); return child; }
  querySelector(selector) {
    if (selector === '.txnCompactMain') return this.main || null;
    if (selector === '.txnCompactMeta') return this.meta || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '.txnCompact') return this.rows || [];
    return [];
  }
}

const elements = new Map();
const html = new Element('html');
html.dataset.appVersion = 'v1.08';
const appVersion = new Element('appVersion'); appVersion.dataset.version = 'v1.08'; elements.set('appVersion', appVersion);
const settingsVersion = new Element('settingsFrontendVersion'); settingsVersion.textContent = 'v1.08'; elements.set('settingsFrontendVersion', settingsVersion);
const refresh = new Element('refreshAppButton'); elements.set('refreshAppButton', refresh);
const title = new Element('withdrawalsTitle'); title.textContent = 'Withdrawals · October'; elements.set('withdrawalsTitle', title);
const cashCurrency = new Element('cashCurrency'); cashCurrency.value = 'THB'; elements.set('cashCurrency', cashCurrency);
const host = new Element('recentWithdrawals'); elements.set('recentWithdrawals', host);
const budgetTab = new Element('budgetTab');

function makeRow(oldText) {
  const row = new Element();
  const main = new Element();
  const meta = new Element();
  meta.className = 'txnCompactMeta';
  meta.textContent = oldText;
  main.meta = meta;
  row.main = main;
  return { row, meta };
}
const a = makeRow('fee $5.40 · bank $378.90 · ATM note with too much detail');
const b = makeRow('fee $4.20 · bank $75.12 · ATM note with too much detail');
host.rows = [a.row, b.row];

const head = new Element('head');
const documentStub = {
  documentElement: html,
  head,
  readyState: 'complete',
  getElementById: id => elements.get(id) || null,
  querySelector: selector => selector === '.lexi-tab[data-view="budget"]' ? budgetTab : null,
  createElement: () => new Element(),
  addEventListener() {}
};
const cache = {
  app: {
    cash: { currency:'THB' },
    cashWallets: {
      THB: {
        monthWithdrawals: [
          { date:'2026-10-25', amount:2345, currency:'THB', atmFee:180, bankDebitUsd:75.12 },
          { date:'2026-10-26', amount:12345, currency:'THB', atmFee:220, bankDebitUsd:378.90 }
        ]
      }
    }
  }
};
const context = {
  document: documentStub,
  localStorage: { getItem: key => key === 'lexiSpendV2AppState' ? JSON.stringify(cache) : null },
  Intl,
  Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-29T12:00:00Z'])); }
  },
  queueMicrotask,
  setTimeout,
  MutationObserver: class { constructor(fn) { this.fn = fn; } observe() {} }
};
context.window = context;
vm.runInNewContext(fs.readFileSync('v2/release.js', 'utf8'), context, { filename:'release.js' });

setImmediate(() => {
  assert.equal(html.dataset.appVersion, 'v1.09');
  assert.equal(appVersion.dataset.version, 'v1.09');
  assert.equal(settingsVersion.textContent, 'v1.09');
  assert.equal(title.textContent, 'Withdrawals October');
  assert.equal(a.meta.textContent, '12,345 THB + 220 THB Fee; Actual Visa Debit Amount $378.90');
  assert.equal(b.meta.textContent, '2,345 THB + 180 THB Fee; Actual Visa Debit Amount $75.12');
  const style = elements.get('v109CashUiStyles');
  assert(style, 'cash UI style injected');
  assert.match(style.textContent, /flex-direction:row/);
  assert.match(style.textContent, /font-size:8\.5px/);
  console.log('PASS Cash v1.09 UI regression');
});
