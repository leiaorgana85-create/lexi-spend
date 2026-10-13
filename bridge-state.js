(() => {
  'use strict';
  const B = window.LexiSpendBridge = {
    URL: 'https://script.google.com/macros/s/AKfycby084l1Rupc838tdinecb2J5NCdOurkIa-smKFJqhypYINd_5walm15NLMWH7vSPWrA/exec',
    KEY: 'lexiSpendPrivateApiCodeV1',
    timeoutMs: 120000,
    frame: null,
    target: null,
    origin: '',
    ready: false,
    readyPromise: null,
    readyResolve: null,
    pending: new Map(),
    nextId: 1,
    codePromise: null,
    codeResolve: null
  };
  B.getCode = () => {
    try { return String(localStorage.getItem(B.KEY) || '').trim(); }
    catch (_) { return ''; }
  };
  B.saveCode = value => {
    const code = String(value || '').trim();
    if (!code) throw new Error('API code is required.');
    localStorage.setItem(B.KEY, code);
    return code;
  };
  B.clearCode = () => {
    try { localStorage.removeItem(B.KEY); } catch (_) {}
  };
  B.allowedOrigin = origin => {
    try {
      const u = new URL(origin);
      return u.protocol === 'https:' && (
        u.hostname === 'script.google.com' ||
        u.hostname === 'script.googleusercontent.com' ||
        u.hostname.endsWith('.googleusercontent.com')
      );
    } catch (_) { return false; }
  };
  B.ensureFrame = () => {
    if (B.frame) return B.frame;
    if (!document.body) throw new Error('Lexi Spend is still loading.');
    const f = document.createElement('iframe');
    f.id = 'lexiSpendApiBridge';
    f.title = 'Lexi Spend private API bridge';
    f.src = B.URL;
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(f);
    B.frame = f;
    return f;
  };
  B.waitReady = () => {
    if (B.ready && B.target && B.origin) return Promise.resolve();
    if (B.readyPromise) return B.readyPromise;
    B.ensureFrame();
    B.readyPromise = new Promise((resolve, reject) => {
      B.readyResolve = resolve;
      setTimeout(() => {
        if (!B.ready) {
          B.readyPromise = null;
          B.readyResolve = null;
          reject(new Error('Could not connect to the Lexi Spend backend.'));
        }
      }, 20000);
    });
    return B.readyPromise;
  };
})();
