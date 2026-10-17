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
      if (!B.frame?.contentWindow || event.source !== B.frame.contentWindow) return;
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
      settlePending(d, 'Lexi Spend Google authorization failed.');
    }
  });

  B.authGoogle = (credential, currentCredential = '', allowRelink = false) => B.waitReady().then(() => new Promise((resolve, reject) => {
    const id = `lexi-google-${Date.now()}-${B.nextId++}`;
    const timer = setTimeout(() => {
      B.pending.delete(id);
      reject(new Error('Lexi Spend Google authorization timed out.'));
    }, B.timeoutMs);
    B.pending.set(id, { resolve, reject, timer });
    B.target.postMessage({
      type: 'lexi-spend-auth-google',
      id,
      credential: String(credential || ''),
      currentCredential: String(currentCredential || ''),
      allowRelink: Boolean(allowRelink)
    }, B.origin);
  }));

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
})();
