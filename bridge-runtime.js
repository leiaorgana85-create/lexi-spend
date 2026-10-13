(() => {
  'use strict';
  const B = window.LexiSpendBridge;

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
    if (d.type !== 'lexi-spend-result') return;
    if (!B.target || event.source !== B.target || event.origin !== B.origin) return;
    const id = String(d.id || '');
    const q = B.pending.get(id);
    if (!q) return;
    clearTimeout(q.timer);
    B.pending.delete(id);
    d.ok ? q.resolve(d.result) : q.reject(new Error(d.error || 'Lexi Spend backend call failed.'));
  });

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
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!B.frame || !B.frame.isConnected) B.ensureFrame();
  });
})();
