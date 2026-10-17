(() => {
  'use strict';
  const B = window.LexiSpendBridge;

  function settlePending(d, fallbackError) {
    if (!B.target || !d || !d.id) return;
    const id = String(d.id || '');
    const q = B.pending.get(id);
    if (!q) return;
    clearTimeout(q.timer);
    B.pending.delete(id);
    d.ok ? q.resolve(d.result) : q.reject(new Error(d.error || fallbackError));
  }

  window.addEventListener('message', event => {
    const d = event.data || {};
    if (d.type === 'lexi-spend-bridge-ready') {
      if (!B.allowedOrigin(event.origin)) return;
      B.target = event.source;
      B.origin = event.origin;
      B.ready = true;
      B.readyResolve?.();
      B.readyPromise = Promise.resolve();
      B.readyResolve = null;
      return;
    }
    if (!B.target || event.source !== B.target || event.origin !== B.origin) return;
    if (d.type === 'lexi-spend-result') {
      settlePending(d, 'Lexi Spend backend call failed.');
      return;
    }
    if (d.type === 'lexi-spend-auth-result') {
      settlePending(d, 'Lexi Spend authorization transfer failed.');
    }
  });

  B.authRequest = (action, payload = {}) => B.waitReady().then(() => new Promise((resolve, reject) => {
    const id = `lexi-auth-${Date.now()}-${B.nextId++}`;
    const timer = setTimeout(() => {
      B.pending.delete(id);
      reject(new Error('Lexi Spend authorization transfer timed out.'));
    }, B.timeoutMs);
    B.pending.set(id, { resolve, reject, timer });
    B.target.postMessage({
      type: `lexi-spend-auth-${action}`,
      id,
      ...payload
    }, B.origin);
  }));

  B.prepareInstallToken = async code => {
    const value = String(code || '').trim();
    if (!value || B.isStandalone() || value.startsWith('lxs1.')) return false;
    try {
      const result = await B.authRequest('mint', { apiCode: value });
      if (!result?.token) return false;
      B.setInstallCookie(String(result.token));
      return true;
    } catch (_) {
      return false;
    }
  };

  B.redeemInstallToken = async () => {
    const token = B.getInstallCookie();
    if (!token) return '';
    try {
      const result = await B.authRequest('redeem', { token });
      const sessionToken = String(result?.sessionToken || '').trim();
      if (!sessionToken) throw new Error('No session token returned.');
      await B.storeCode(sessionToken);
      B.clearInstallCookie();
      return sessionToken;
    } catch (_) {
      B.clearInstallCookie();
      return '';
    }
  };

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', {
    configurable: true,
    get() { return B.runner(); }
  });

  window.LexiSpendApi = {
    clearAuthorization() { B.clearCode(); B.showGate(); },
    reconnect() {
      B.clearCode();
      B.recreateFrame();
      return B.ensureCode();
    }
  };

  // Start the Apps Script bridge as soon as <body> exists, rather than
  // waiting for the whole Spend UI to finish parsing.
  B.warmBridge();

  window.addEventListener('pageshow', () => {
    if (!B.frame || !B.frame.isConnected) B.ensureFrame();
    const code = B.getCode();
    if (code && !B.isStandalone()) B.prepareInstallToken(code);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!B.frame || !B.frame.isConnected) B.ensureFrame();
    const code = B.getCode();
    if (code && !B.isStandalone()) B.prepareInstallToken(code);
  });
})();
