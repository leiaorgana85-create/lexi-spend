(() => {
  'use strict';
  const B = window.LexiSpendBridge;
  window.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('settingsDialog');
    const actions = dialog?.querySelector('.dlgActions');
    if (!dialog || !actions || document.getElementById('lexiApiReplace')) return;
    const block = document.createElement('div');
    block.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)';
    block.innerHTML = `<div style="font-size:12px;font-weight:800;margin-bottom:5px">Private API access</div><div style="font-size:11px;color:var(--muted);line-height:1.35;margin-bottom:8px">API code is ${B.getCode() ? 'saved on this device' : 'not saved on this device'}.</div><button id="lexiApiReplace" class="secondary" type="button" style="min-height:34px">Replace API code</button>`;
    actions.parentNode.insertBefore(block, actions);
    block.querySelector('#lexiApiReplace').addEventListener('click', () => {
      if (dialog.open) dialog.close();
      B.clearCode();
      B.showGate();
    });
  });
})();
