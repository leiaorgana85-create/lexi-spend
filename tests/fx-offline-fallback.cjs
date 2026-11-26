const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const FX_KEY = 'lexiSpendV2FxRatesV1';
const source = fs.readFileSync('v2/api.js', 'utf8');

function makeHarness(savedRates) {
  const storage = new Map([[FX_KEY, JSON.stringify(savedRates)]]);
  const frame = {
    isConnected: false,
    style: {},
    setAttribute() {},
    remove() { this.isConnected = false; }
  };
  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    body: {
      dataset: {},
      appendChild(node) { node.isConnected = true; }
    },
    createElement() { return frame; },
    getElementById() { return null; },
    addEventListener() {}
  };
  const window = {
    addEventListener() {},
    dispatchEvent() {},
    open() {}
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const context = {
    window,
    document,
    localStorage,
    navigator: { onLine: false },
    URL,
    Event,
    setTimeout,
    clearTimeout,
    console
  };
  vm.runInNewContext(source, context, { filename: 'v2/api.js' });
  return window.SpendApi;
}

(async () => {
  const api = makeHarness({
    'THB:2026-10-30': { rate: 0.0305, effectiveDate: '2026-10-30', source: 'fixture' },
    'THB:2026-10-31': { rate: 0.0308, effectiveDate: '2026-10-31', source: 'fixture' },
    'THB:2026-11-02': { rate: 0.0315, effectiveDate: '2026-11-02', source: 'future-fixture' },
    'KRW:2026-10-31': { rate: 0.0007, effectiveDate: '2026-10-31', source: 'fixture' }
  });

  const fallback = await api.call('previewUsd', [100, 'THB', '2026-11-01']);
  assert.equal(fallback.rate, 0.0308, 'offline lookup uses newest saved THB rate on or before requested date');
  assert.equal(fallback.effectiveDate, '2026-10-31');
  assert.equal(fallback.usdAmount, 3.08);

  const exact = await api.call('previewUsd', [100, 'THB', '2026-10-30']);
  assert.equal(exact.rate, 0.0305, 'exact dated cache remains authoritative when present');
  assert.equal(exact.usdAmount, 3.05);

  await assert.rejects(
    api.call('previewUsd', [100, 'VND', '2026-11-01']),
    /No saved exchange rate available/,
    'offline lookup still fails clearly when that currency has never been cached'
  );

  console.log('PASS offline FX fallback: latest prior saved rate, exact-date priority, no future-rate use.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
