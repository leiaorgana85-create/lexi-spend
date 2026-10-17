(() => {
  'use strict';
  const B = window.LexiSpendBridge = {
    URL: 'https://script.google.com/macros/s/AKfycby084l1Rupc838tdinecb2J5NCdOurkIa-smKFJqhypYINd_5walm15NLMWH7vSPWrA/exec',
    KEY: 'lexiSpendPrivateApiCodeV1',
    LEGACY_COOKIE: 'lexi_spend_api_code_v1',
    INSTALL_COOKIE: 'lexi_spend_install_v1',
    INSTALL_COOKIE_PATH: '/lexi-spend/',
    DB_NAME: 'lexi-spend-auth-v1',
    DB_STORE: 'kv',
    DB_KEY: 'apiCode',
    timeoutMs: 120000,
    readyTimeoutMs: 45000,
    frame: null,
    target: null,
    origin: '',
    ready: false,
    readyPromise: null,
    readyResolve: null,
    pending: new Map(),
    nextId: 1,
    codePromise: null,
    codeResolve: null,
    warmStarted: false
  };

  B.isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

  B.readCookie = name => {
    try {
      const prefix = `${name}=`;
      const row = document.cookie.split('; ').find(v => v.startsWith(prefix));
      return row ? decodeURIComponent(row.slice(prefix.length)).trim() : '';
    } catch (_) { return ''; }
  };

  B.clearLegacyCookie = () => {
    try { document.cookie = `${B.LEGACY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`; } catch (_) {}
  };

  B.getInstallCookie = () => B.readCookie(B.INSTALL_COOKIE);
  B.setInstallCookie = token => {
    try { document.cookie = `${B.INSTALL_COOKIE}=${encodeURIComponent(token)}; Max-Age=600; Path=${B.INSTALL_COOKIE_PATH}; SameSite=Strict; Secure`; } catch (_) {}
  };
  B.clearInstallCookie = () => {
    try { document.cookie = `${B.INSTALL_COOKIE}=; Max-Age=0; Path=${B.INSTALL_COOKIE_PATH}; SameSite=Strict; Secure`; } catch (_) {}
  };

  B.openDb = () => new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable.')); return; }
    const req = indexedDB.open(B.DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(B.DB_STORE)) db.createObjectStore(B.DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open auth storage.'));
  });

  B.readIndexedCode = async () => {
    try {
      const db = await B.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(B.DB_STORE, 'readonly');
        const req = tx.objectStore(B.DB_STORE).get(B.DB_KEY);
        req.onsuccess = () => resolve(String(req.result || '').trim());
        req.onerror = () => reject(req.error || new Error('Could not read auth storage.'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
        tx.onabort = () => db.close();
      });
    } catch (_) { return ''; }
  };

  B.writeIndexedCode = async code => {
    const db = await B.openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(B.DB_STORE, 'readwrite');
      tx.objectStore(B.DB_STORE).put(code, B.DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const e = tx.error; db.close(); reject(e || new Error('Could not save auth storage.')); };
      tx.onabort = () => { const e = tx.error; db.close(); reject(e || new Error('Could not save auth storage.')); };
    });
  };

  B.deleteIndexedCode = async () => {
    try {
      const db = await B.openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(B.DB_STORE, 'readwrite');
        tx.objectStore(B.DB_STORE).delete(B.DB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not clear auth storage.'));
        tx.onabort = () => reject(tx.error || new Error('Could not clear auth storage.'));
      });
      db.close();
    } catch (_) {}
  };

  B.getCode = () => {
    try { return String(localStorage.getItem(B.KEY) || '').trim(); } catch (_) { return ''; }
  };

  B.maybePrepareInstallToken = code => {
    const value = String(code || '').trim();
    if (!value || B.isStandalone() || value.startsWith('lxs1.')) return;
    B.prepareInstallToken?.(value).catch(() => {});
  };

  B.storeCode = async value => {
    const code = String(value || '').trim();
    if (!code) throw new Error('API code is required.');
    let localSaved = false;
    try {
      localStorage.setItem(B.KEY, code);
      localSaved = String(localStorage.getItem(B.KEY) || '').trim() === code;
    } catch (_) {}
    let indexedSaved = false;
    try {
      await B.writeIndexedCode(code);
      indexedSaved = (await B.readIndexedCode()) === code;
    } catch (_) {}
    if (!localSaved && !indexedSaved) throw new Error('Safari did not allow Lexi Spend to save authorization on this device.');
    return code;
  };

  B.getCodeDurable = async () => {
    const immediate = B.getCode();
    if (immediate) {
      B.clearLegacyCookie();
      B.maybePrepareInstallToken(immediate);
      return immediate;
    }

    const legacy = B.readCookie(B.LEGACY_COOKIE);
    if (legacy) {
      try {
        await B.storeCode(legacy);
        B.clearLegacyCookie();
        B.maybePrepareInstallToken(legacy);
        return legacy;
      } catch (_) {}
    }

    const indexed = await B.readIndexedCode();
    if (indexed) {
      try { localStorage.setItem(B.KEY, indexed); } catch (_) {}
      B.clearLegacyCookie();
      B.maybePrepareInstallToken(indexed);
      return indexed;
    }

    const transferred = await B.redeemInstallToken?.();
    return transferred || '';
  };

  B.saveCode = async value => {
    const code = await B.storeCode(value);
    B.clearLegacyCookie();
    B.maybePrepareInstallToken(code);
    return code;
  };

  B.clearCode = () => {
    try { localStorage.removeItem(B.KEY); } catch (_) {}
    B.clearLegacyCookie();
    B.clearInstallCookie();
    B.deleteIndexedCode();
  };

  B.allowedOrigin = origin => {
    try {
      const u = new URL(origin);
      return u.protocol === 'https:' && (u.hostname === 'script.google.com' || u.hostname === 'script.googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com'));
    } catch (_) { return false; }
  };

  B.frameUrl = () => {
    const joiner = B.URL.includes('?') ? '&' : '?';
    return `${B.URL}${joiner}lexiBridge=${Date.now()}`;
  };

  B.ensureFrame = () => {
    if (B.frame && B.frame.isConnected) return B.frame;
    if (!document.body) return null;
    const f = document.createElement('iframe');
    f.id = 'lexiSpendApiBridge';
    f.title = 'Lexi Spend private API bridge';
    f.src = B.frameUrl();
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(f);
    B.frame = f;
    return f;
  };

  B.recreateFrame = () => {
    try { B.frame?.remove(); } catch (_) {}
    B.frame = null;
    B.target = null;
    B.origin = '';
    B.ready = false;
    B.readyPromise = null;
    B.readyResolve = null;
    return B.ensureFrame();
  };

  B.warmBridge = () => {
    if (B.warmStarted) return;
    B.warmStarted = true;
    const start = () => {
      if (B.frame && B.frame.isConnected) return true;
      if (!document.body) return false;
      B.ensureFrame();
      return true;
    };
    if (start()) return;
    const observer = new MutationObserver(() => { if (start()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => { start(); observer.disconnect(); }, { once: true });
  };

  B.waitReady = () => {
    if (B.ready && B.target && B.origin) return Promise.resolve();
    if (B.readyPromise) return B.readyPromise;
    B.warmBridge();
    B.ensureFrame();
    B.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (B.ready) return;
        B.readyPromise = null;
        B.readyResolve = null;
        reject(new Error('Could not connect to the Lexi Spend backend.'));
      }, B.readyTimeoutMs);
      B.readyResolve = () => { clearTimeout(timer); resolve(); };
    });
    return B.readyPromise;
  };
})();
