(() => {
  'use strict';
  const B = window.LexiSpendBridge;

  B.ensureGate = () => {
    let gate = document.getElementById('lexiApiGate');
    if (gate) return gate;

    gate = document.createElement('div');
    gate.id = 'lexiApiGate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(15,17,21,.96)';
    gate.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="lexiApiTitle" style="width:min(420px,100%);background:#171a20;color:#f3f4f6;border:1px solid #30343c;border-radius:16px;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.45)"><h2 id="lexiApiTitle" style="margin:0 0 8px;font-size:21px">Lexi Spend API Code</h2><p style="margin:0 0 14px;color:#9ca3af;font-size:14px;line-height:1.45">Enter your private API code once. Lexi Spend will save it on this device so you do not have to enter it again.</p><input id="lexiApiCodeInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Private API code" style="width:100%;height:44px;border:1px solid #3f4650;border-radius:10px;background:#1d2128;color:#f3f4f6;padding:0 12px;font:inherit;outline:none"><div id="lexiApiError" aria-live="polite" style="min-height:20px;margin-top:8px;color:#fca5a5;font-size:13px"></div><button id="lexiApiSave" type="button" style="width:100%;min-height:44px;border:0;border-radius:10px;background:#f3f4f6;color:#111827;font:700 15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">Save API Code</button></div>`;
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
        button.textContent = 'Save API Code';
      }
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    return gate;
  };

  B.showGate = (message = '') => {
    const gate = B.ensureGate();
    gate.querySelector('#lexiApiError').textContent = message;
    gate.style.display = 'flex';
    setTimeout(() => gate.querySelector('#lexiApiCodeInput').focus(), 0);
  };

  B.ensureCode = async () => {
    const code = await B.getCodeDurable();
    if (code) return code;
    if (B.codePromise) return B.codePromise;
    B.codePromise = new Promise(resolve => { B.codeResolve = resolve; });
    B.showGate();
    return B.codePromise;
  };
})();
