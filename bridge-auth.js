(() => {
  'use strict';
  const B = window.LexiSpendBridge;
  const GOOGLE_CLIENT_ID = '543436064136-27a477uk691qocpaft25q925lg88hl98.apps.googleusercontent.com';
  const GOOGLE_LINK_MARKER = 'lexiSpendGoogleLinkedV1';

  function googleLinkedLocally() {
    try { return localStorage.getItem(GOOGLE_LINK_MARKER) === '1'; }
    catch (_) { return false; }
  }

  async function loadGoogleIdentity() {
    if (window.google?.accounts?.id) return;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-lexi-google-identity]');
      if (existing) {
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', reject, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.lexiGoogleIdentity = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Google sign-in.'));
      document.head.appendChild(script);
    });
  }

  B.ensureGate = () => {
    let gate = document.getElementById('lexiApiGate');
    if (gate) return gate;
    gate = document.createElement('div');
    gate.id = 'lexiApiGate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(15,17,21,.96)';
    gate.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="lexiApiTitle" style="width:min(420px,100%);background:#171a20;color:#f3f4f6;border:1px solid #30343c;border-radius:16px;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.45)"><h2 id="lexiApiTitle" style="margin:0 0 8px;font-size:21px">Connect Lexi Spend</h2><p id="lexiApiCopy" style="margin:0 0 14px;color:#9ca3af;font-size:14px;line-height:1.45"></p><div id="lexiGoogleButton" style="min-height:44px;display:flex;justify-content:center"></div><div id="lexiApiError" aria-live="polite" style="min-height:20px;margin-top:8px;color:#fca5a5;font-size:13px"></div><div style="display:flex;align-items:center;gap:10px;margin:5px 0 11px;color:#6b7280;font-size:11px"><span style="height:1px;background:#30343c;flex:1"></span><span>API recovery</span><span style="height:1px;background:#30343c;flex:1"></span></div><input id="lexiApiCodeInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Private API code" style="width:100%;height:44px;border:1px solid #3f4650;border-radius:10px;background:#1d2128;color:#f3f4f6;padding:0 12px;font:inherit;outline:none"><button id="lexiApiSave" type="button" style="width:100%;min-height:42px;margin-top:8px;border:1px solid #3f4650;border-radius:10px;background:transparent;color:#f3f4f6;font:700 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">Use API Code</button><button id="lexiApiLater" type="button" style="display:none;width:100%;min-height:36px;margin-top:8px;border:0;background:transparent;color:#9ca3af;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">Not now</button></div>`;
    document.body.appendChild(gate);

    const input = gate.querySelector('#lexiApiCodeInput');
    const error = gate.querySelector('#lexiApiError');
    const button = gate.querySelector('#lexiApiSave');
    const submit = async () => {
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const code = await B.saveCode(input.value);
        error.textContent = '';
        input.value = '';
        gate.style.display = 'none';
        B.codeResolve?.(code);
        B.codePromise = null;
        B.codeResolve = null;
      } catch (e) {
        error.textContent = e?.message || 'Could not save the API code.';
      } finally {
        button.disabled = false;
        button.textContent = 'Use API Code';
      }
    };
    button.addEventListener('click', submit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    gate.querySelector('#lexiApiLater').addEventListener('click', () => { gate.style.display = 'none'; });
    return gate;
  };

  B.renderGoogleAuth = async gate => {
    const holder = gate.querySelector('#lexiGoogleButton');
    const error = gate.querySelector('#lexiApiError');
    holder.innerHTML = '';
    try {
      await loadGoogleIdentity();
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async response => {
          error.textContent = '';
          try {
            const existing = await B.getCodeDurable();
            const result = await B.authGoogle(String(response?.credential || ''), existing);
            const sessionToken = String(result?.sessionToken || '').trim();
            if (!sessionToken) throw new Error('Lexi Spend authorization was not returned.');
            await B.storeCode(sessionToken);
            localStorage.setItem(GOOGLE_LINK_MARKER, '1');
            gate.style.display = 'none';
            B.codeResolve?.(sessionToken);
            B.codePromise = null;
            B.codeResolve = null;
          } catch (e) {
            error.textContent = e?.message || 'Could not connect Google.';
          }
        }
      });
      window.google.accounts.id.renderButton(holder, {
        theme:'outline', size:'large', text:'continue_with', shape:'rectangular', width:300
      });
    } catch (e) {
      error.textContent = e?.message || 'Could not load Google sign-in.';
    }
  };

  B.showGate = (message = '', mode = 'auth') => {
    const gate = B.ensureGate();
    const hasCredential = Boolean(B.getCode());
    gate.querySelector('#lexiApiTitle').textContent = mode === 'link' ? 'Connect Google once' : 'Connect Lexi Spend';
    gate.querySelector('#lexiApiCopy').textContent = mode === 'link'
      ? 'Connect your Google account once so future Home Screen installs can restore access without typing the API code.'
      : 'Use your linked Google account to restore Lexi Spend access. The private API code remains available only as recovery.';
    gate.querySelector('#lexiApiError').textContent = message;
    gate.querySelector('#lexiApiLater').style.display = mode === 'link' && hasCredential ? 'block' : 'none';
    gate.style.display = 'flex';
    B.renderGoogleAuth(gate);
  };

  B.ensureCode = async () => {
    const code = await B.getCodeDurable();
    if (code) return code;
    if (B.codePromise) return B.codePromise;
    B.codePromise = new Promise(resolve => { B.codeResolve = resolve; });
    B.showGate();
    return B.codePromise;
  };

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      if (googleLinkedLocally()) return;
      const code = await B.getCodeDurable();
      if (code) B.showGate('', 'link');
    }, 700);
  });
})();
