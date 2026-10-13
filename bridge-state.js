(() => {
  'use strict';
  const B = window.LexiSpendBridge = {
    URL: 'https://script.google.com/macros/s/AKfycby084l1Rupc838tdinecb2J5NCdOurkIa-smKFJqhypYINd_5walm15NLMWH7vSPWrA/exec',
    KEY: 'lexiSpendPrivateApiCodeV1',
    COOKIE: 'lexi_spend_api_code_v1',
    DB_NAME: 'lexi-spend-auth-v1',
    DB_STORE: 'kv',
    DB_KEY: 'apiCode',
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

  B.getCookie = () => {
    try {
      const prefix = `${B.COOKIE}=`;
      const row = document.cookie.split('; ').find(v => v.startsWith(prefix));
      return row ? decodeURIComponent(row.slice(prefix.length)).trim() : '';
    } catch (_) {
      return '';
    }
  };

  B.setCookie = code => {
    try {
      document.cookie = `${B.COOKIE}=${encodeURIComponent(code)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
    } catch (_) {}
  };

  B.clearCookie = () => {
    try {
      document.cookie = `${B.COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    } catch (_) {}
  };

  B.openDb = () => new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable.'));
      return;
    }
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
    } catch (_) {
      return '';
    }
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
    try {
      const local = String(localStorage.getItem(B.KEY) || '').trim();
      if (local) return local;
    } catch (_) {}
    return B.getCookie();
  };

  B.getCodeDurable = async () => {
    const immediate = B.getCode();
    if (immediate) return immediate;
    const indexed = await B.readIndexedCode();
    if (!indexed) return '';
    try { localStorage.setItem(B.KEY, indexed); } catch (_) {}
    B.setCookie(indexed);
    return indexed;
  };

  B.saveCode = async value => {
    const code = String(value || '').trim();
    if (!code) throw new Error('API code is required.');
    let localSaved = false;
    try {
      localStorage.setItem(B.KEY, code);
      localSaved = String(localStorage.getItem(B.KEY) || '').trim() === code;
    } catch (_) {}
    B.setCookie(code);
    let indexedSaved = false;
    try {
      await B.writeIndexedCode(code);
      indexedSaved = (await B.readIndexedCode()) === code;
    } catch (_) {}
    if (!localSaved && B.getCookie() !== code && !indexedSaved) {
      throw new Error('Safari did not allow Lexi Spend to save the API code on this device.');
    }
    return code;
  };

  B.clearCode = () => {
    try { localStorage.removeItem(B.KEY); } catch (_) {}
    B.clearCookie();
    B.deleteIndexedCode();
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
