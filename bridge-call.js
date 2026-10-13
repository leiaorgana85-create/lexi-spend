(() => {
  'use strict';
  const B = window.LexiSpendBridge;
  B.call = (name, params, code) => B.waitReady().then(() => new Promise((resolve, reject) => {
    const id = `lexi-${Date.now()}-${B.nextId++}`;
    const timer = setTimeout(() => {
      B.pending.delete(id);
      reject(new Error('Lexi Spend backend request timed out.'));
    }, B.timeoutMs);
    B.pending.set(id, { resolve, reject, timer });
    B.target.postMessage({
      type: 'lexi-spend-call', id, apiCode: code,
      functionName: name, parameters: Array.isArray(params) ? params : []
    }, B.origin);
  }));
  B.execute = async (name, params = [], retry = true) => {
    const code = await B.ensureCode();
    try { return await B.call(name, params, code); }
    catch (e) {
      const msg = String(e?.message || e || '');
      if (retry && /invalid lexi spend api code|missing lexi spend api code/i.test(msg)) {
        B.clearCode();
        B.showGate('That API code was not accepted. Enter the current private code.');
        return B.call(name, params, await B.ensureCode());
      }
      throw e;
    }
  };
  B.runner = (h = {}) => new Proxy({}, {
    get(_t, p) {
      if (p === 'withSuccessHandler') return fn => B.runner({ ...h, success: fn });
      if (p === 'withFailureHandler') return fn => B.runner({ ...h, failure: fn });
      if (p === 'withUserObject') return userObject => B.runner({ ...h, userObject });
      return (...params) => B.execute(String(p), params)
        .then(r => h.success?.(r, h.userObject))
        .catch(e => h.failure ? h.failure(e, h.userObject) : console.error(e));
    }
  });
})();
