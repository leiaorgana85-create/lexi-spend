(() => {
  'use strict';

  const BACKEND_URL = 'https://script.google.com/macros/s/AKfycby084l1Rupc838tdinecb2J5NCdOurkIa-smKFJqhypYINd_5walm15NLMWH7vSPWrA/exec';
  const BRIDGE_URL = `${BACKEND_URL}?lexiSpendV2=2`;
  const AUTH_KEY = 'lexiSpendPrivateApiCodeV1';
  const AUTH_DB = 'lexi-spend-auth-v1';
  const AUTH_STORE = 'kv';
  const AUTH_DB_KEY = 'apiCode';
  const REQUEST_TIMEOUT_MS = 120000;
  const READY_TIMEOUT_MS = 20000;
  const CALENDAR_CACHE_PREFIX = 'lexiSpendV2Calendar:';
  const CALENDAR_READ_TTL_MS = 60 * 1000;
  let frame = null;
  let target = null;
  let targetOrigin = '';
  let readyPromise = null;
  let readyResolve = null;
  let nextId = 1;
  const pending = new Map();
  const calendarRefreshes = new Map();

  function allowedOrigin(origin) {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && (
        url.hostname === 'script.google.com' ||
        url.hostname === 'script.googleusercontent.com' ||
        url.hostname.endsWith('.googleusercontent.com')
      );
    } catch (_) {
      return false;
    }
  }

  function openAuthDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB unavailable.'));
        return;
      }
      const request = indexedDB.open(AUTH_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUTH_STORE)) {
          db.createObjectStore(AUTH_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open authorization storage.'));
    });
  }

  async function readIndexedAuth() {
    try {
      const db = await openAuthDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTH_STORE, 'readonly');
        const request = tx.objectStore(AUTH_STORE).get(AUTH_DB_KEY);
        request.onsuccess = () => resolve(String(request.result || '').trim());
        request.onerror = () => reject(request.error || new Error('Could not read authorization storage.'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
        tx.onabort = () => db.close();
      });
    } catch (_) {
      return '';
    }
  }

  async function writeIndexedAuth(code) {
    try {
      const db = await openAuthDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTH_STORE, 'readwrite');
        tx.objectStore(AUTH_STORE).put(code, AUTH_DB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save authorization storage.'));
        tx.onabort = () => reject(tx.error || new Error('Could not save authorization storage.'));
      });
      db.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function deleteIndexedAuth() {
    try {
      const db = await openAuthDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTH_STORE, 'readwrite');
        tx.objectStore(AUTH_STORE).delete(AUTH_DB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not clear authorization storage.'));
        tx.onabort = () => reject(tx.error || new Error('Could not clear authorization storage.'));
      });
      db.close();
    } catch (_) {}
  }

  async function readCode() {
    try {
      const local = String(localStorage.getItem(AUTH_KEY) || '').trim();
      if (local) return local;
    } catch (_) {}

    const indexed = await readIndexedAuth();
    if (indexed) {
      try { localStorage.setItem(AUTH_KEY, indexed); } catch (_) {}
    }
    return indexed;
  }

  async function saveCode(value) {
    const code = String(value || '').trim();
    if (!code) throw new Error('API code is required.');

    let localSaved = false;
    try {
      localStorage.setItem(AUTH_KEY, code);
      localSaved = String(localStorage.getItem(AUTH_KEY) || '').trim() === code;
    } catch (_) {}

    const indexedSaved = await writeIndexedAuth(code);
    if (!localSaved && !indexedSaved) {
      throw new Error('Safari did not allow Lexi Spend to save authorization on this device.');
    }
    return code;
  }

  async function clearCode() {
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
    await deleteIndexedAuth();
  }

  function ensureFrame(forceFresh = false) {
    if (frame?.isConnected) return frame;
    const iframe = document.createElement('iframe');
    iframe.id = 'lexiSpendV2ApiBridge';
    iframe.title = 'Lexi Spend private API bridge';
    iframe.src = forceFresh ? `${BRIDGE_URL}&retry=${Date.now()}` : BRIDGE_URL;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);
    frame = iframe;
    return iframe;
  }

  function resetBridge() {
    try { frame?.remove(); } catch (_) {}
    frame = null;
    target = null;
    targetOrigin = '';
    readyPromise = null;
    readyResolve = null;
    ensureFrame(true);
  }

  function waitReady() {
    if (target && targetOrigin) return Promise.resolve();
    if (readyPromise) return readyPromise;

    ensureFrame();
    readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (target && targetOrigin) return;
        readyPromise = null;
        readyResolve = null;
        reject(new Error('Could not connect to the Lexi Spend backend.'));
      }, READY_TIMEOUT_MS);

      readyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    return readyPromise;
  }

  function settle(data) {
    const id = String(data?.id || '');
    if (!id) return;
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.error || 'Lexi Spend backend request failed.'));
  }

  window.addEventListener('message', event => {
    const data = event.data || {};

    if (data.type === 'lexi-spend-bridge-ready') {
      if (!frame?.isConnected || !event.source || !allowedOrigin(event.origin)) return;
      if (target && event.source !== target) return;
      target = event.source;
      targetOrigin = event.origin;
      readyResolve?.();
      readyPromise = Promise.resolve();
      readyResolve = null;
      return;
    }

    if (!target || event.source !== target || event.origin !== targetOrigin) return;
    if (data.type === 'lexi-spend-result') settle(data);
  });

  function calendarCacheKey(month) {
    return `${CALENDAR_CACHE_PREFIX}${month}`;
  }

  function readCalendarCache(month) {
    try {
      const cached = JSON.parse(localStorage.getItem(calendarCacheKey(month)) || 'null');
      if (!cached?.data) return null;
      return {
        savedAt: Number(cached.savedAt || 0),
        data: cached.data
      };
    } catch (_) {
      return null;
    }
  }

  function writeCalendarCache(month, data) {
    try {
      localStorage.setItem(calendarCacheKey(month), JSON.stringify({
        savedAt: Date.now(),
        data
      }));
    } catch (_) {}
  }

  function validCalendarMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '').trim());
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async function callBackend(functionName, parameters = [], options = {}) {
    const code = await readCode();
    if (!code) throw new Error('NOT_CONNECTED');

    await waitReady();

    return await new Promise((resolve, reject) => {
      const id = `lexi-v2-${Date.now()}-${nextId++}`;
      const requestedTimeout = Number(options?.timeoutMs || 0);
      const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? requestedTimeout
        : REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Lexi Spend backend request timed out.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      target.postMessage({
        type: 'lexi-spend-v2-call',
        id,
        apiCode: code,
        functionName: String(functionName || ''),
        parameters: Array.isArray(parameters) ? parameters : []
      }, targetOrigin);
    }).catch(async error => {
      const message = String(error?.message || error || '');
      if (/invalid lexi spend api code|missing lexi spend api code/i.test(message)) {
        await clearCode();
        throw new Error('NOT_CONNECTED');
      }
      throw error;
    });
  }

  function refreshCalendarMonth(month, options = {}) {
    const normalized = String(month || '').trim();
    if (!validCalendarMonth(normalized)) {
      return Promise.reject(new Error('Invalid calendar month.'));
    }
    if (calendarRefreshes.has(normalized)) return calendarRefreshes.get(normalized);

    const request = callBackend('getCalendarMonth', [normalized], options)
      .then(data => {
        writeCalendarCache(normalized, data);
        return data;
      })
      .finally(() => {
        if (calendarRefreshes.get(normalized) === request) calendarRefreshes.delete(normalized);
      });

    calendarRefreshes.set(normalized, request);
    return request;
  }

  async function call(functionName, parameters = [], options = {}) {
    const name = String(functionName || '').trim();
    if (name !== 'getCalendarMonth') {
      return callBackend(name, parameters, options);
    }

    const month = String(Array.isArray(parameters) ? parameters[0] || '' : '').trim();
    if (!validCalendarMonth(month)) return callBackend(name, parameters, options);

    const cached = readCalendarCache(month);
    if (cached?.data) {
      const fresh = cached.savedAt > 0 && Date.now() - cached.savedAt < CALENDAR_READ_TTL_MS;
      if (!fresh) {
        void refreshCalendarMonth(month, options).catch(() => {});
      }
      return cached.data;
    }

    return refreshCalendarMonth(month, options);
  }

  async function connect(code, today) {
    await saveCode(code);
    resetBridge();
    try {
      return await callBackend('getAppState', [today, '']);
    } catch (error) {
      await clearCode();
      throw error;
    }
  }

  async function hasCode() {
    const code = await readCode();
    if (!code) return false;

    const month = currentMonthKey();
    const cached = readCalendarCache(month);
    const fresh = cached?.data && cached.savedAt > 0 && Date.now() - cached.savedAt < CALENDAR_READ_TTL_MS;
    if (!fresh) {
      void refreshCalendarMonth(month).catch(() => {});
    }
    return true;
  }

  ensureFrame();

  window.SpendApi = Object.freeze({
    call,
    connect,
    clearCode,
    hasCode,
    resetBridge
  });
})();
