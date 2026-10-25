(() => {
  'use strict';
  if (window.LexiLifecycle) return;
  const script = document.currentScript;
  const app = script?.dataset.app || 'Lexi';
  const build = script?.dataset.build || 'lifecycle-1';
  const key = `lexiLifecycleV1:${app}`;
  const page = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const startedAt = new Date().toISOString();
  let hiddenAt = document.hidden ? Date.now() : 0;
  let storageAvailable = true;
  let entries = [];
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) entries = saved.filter(e => e && typeof e.event === 'string').slice(-159);
  } catch (_) { storageAvailable = false; }

  function record(event, detail = {}) {
    entries.push({ at: new Date().toISOString(), page, event, ...detail });
    entries = entries.slice(-160);
    try { localStorage.setItem(key, JSON.stringify(entries)); }
    catch (_) { storageAvailable = false; }
  }
  // Only known event names and build identifiers are accepted. Never collect
  // DOM text, form values, request URLs, API keys, note contents or error messages.
  const allowed = new Set(['update-reload', 'data-refresh-start', 'data-refresh-end']);
  function mark(event, detail = {}) {
    if (!allowed.has(event)) return;
    const safe = {};
    if (event === 'update-reload') {
      for (const name of ['from', 'to']) safe[name] = String(detail[name] || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100);
    }
    record(event, safe);
  }
  const operations = new Set(['getAppState', 'getCalendarMonth', 'previewUsd', 'logExpense',
    'deleteExpense', 'addCashWithdrawal', 'deleteCashWithdrawal', 'uploadReceipt']);
  function sync(event, detail = {}) {
    if (!['ack', 'error', 'confirmed'].includes(event) || !operations.has(detail.operation)) return;
    const safe = { operation:detail.operation };
    if (Number.isFinite(detail.durationMs) && detail.durationMs >= 0) safe.durationMs = Math.round(detail.durationMs);
    record(`sync-${event}`, safe);
  }
  function snapshot() {
    return {
      schemaVersion: 1, app, build, exportedAt: new Date().toISOString(),
      currentPage: page, storageAvailable,
      environment: {
        standalone: Boolean(navigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches),
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller)
      },
      limitation: 'A new document is observable; its cause (OS termination, crash, or relaunch) is not always exposed by iOS.',
      events: entries.map(e => ({ ...e }))
    };
  }
  window.LexiLifecycle = Object.freeze({ mark, sync, snapshot });
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  record('launch', {
    build, navigation: nav?.type || 'unknown',
    visibility: document.visibilityState, online: navigator.onLine,
    wasDiscarded: typeof document.wasDiscarded === 'boolean' ? document.wasDiscarded : null
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      record('hidden');
    } else {
      record('resume', { awayMs: hiddenAt ? Date.now() - hiddenAt : null, online: navigator.onLine });
      hiddenAt = 0;
    }
  });
  window.addEventListener('pagehide', e => record('pagehide', { persisted: Boolean(e.persisted) }));
  window.addEventListener('pageshow', e => record('pageshow', { persisted: Boolean(e.persisted) }));
  window.addEventListener('online', () => record('online'));
  window.addEventListener('offline', () => record('offline'));
  window.addEventListener('error', () => record('script-or-resource-error'), true);
  window.addEventListener('unhandledrejection', () => record('unhandled-rejection'));
  navigator.serviceWorker?.addEventListener('controllerchange', () => record('service-worker-controller-change'));

  function mount() {
    const anchor = document.getElementById('settingsBtn') || document.getElementById('settingsButton') || document.getElementById('refreshBtn');
    if (!anchor) return;
    const style = document.createElement('style');
    style.textContent = `
      .lexi-diag-launch { flex:0 0 32px; width:32px; height:32px; padding:6px; margin:0; border:0; background:transparent; color:inherit; display:inline-grid; place-items:center; border-radius:8px; }
      .lexi-diag-launch svg { width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:1.8; }
      #lexiLifecycleDialog { box-sizing:border-box; width:min(92vw,440px); max-height:85dvh; overflow:auto; padding:18px; border:1px solid #666; border-radius:14px; background:#15171b; color:#f5f5f5; font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; }
      #lexiLifecycleDialog::backdrop { background:rgba(0,0,0,.6); }
      #lexiLifecycleDialog h2 { margin:0 0 10px; font-size:18px; color:inherit; }
      #lexiLifecycleDialog p { margin:10px 0; color:inherit; }
      #lexiLifecycleDialog button { display:inline-block; font:inherit; border:1px solid #777; border-radius:8px; padding:8px 12px; margin:4px 6px 4px 0; background:#272b32; color:#fff; }
      #lexiLifecycleDialog pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:32dvh; overflow:auto; font:12px/1.5 ui-monospace,monospace; background:#0c0e11; color:#ddd; padding:10px; border-radius:8px; }
    `;
    document.head.appendChild(style);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lexi-diag-launch';
    button.setAttribute('aria-label', 'App diagnostics');
    button.title = 'App diagnostics';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg>';
    anchor.parentNode.insertBefore(button, anchor);
    const dialog = document.createElement('dialog');
    dialog.id = 'lexiLifecycleDialog';
    dialog.setAttribute('aria-labelledby', 'lexiLifecycleTitle');
    dialog.innerHTML = '<h2 id="lexiLifecycleTitle">App diagnostics</h2><p class="diag-summary"></p><p class="diag-sync"></p><p>Timings measure this device’s request through acknowledgement, including connection time. Queue-to-confirm includes time waiting offline. These are not separate server-write timings. Logs contain technical events, without notes or spending details.</p><button type="button" data-diag="share">Share log</button><button type="button" data-diag="download">Download log</button><button type="button" data-diag="close">Close</button><p class="diag-status" role="status"></p><pre></pre>';
    document.body.appendChild(dialog);
    const status = dialog.querySelector('.diag-status');
    function makeFile() {
      const filename = `${app.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-lifecycle-log.json`;
      return new File([JSON.stringify(snapshot(), null, 2)], filename, { type:'application/json' });
    }
    function download() {
      const file = makeFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = 'Log opened for saving.';
    }
    dialog.querySelector('[data-diag="share"]').addEventListener('click', async () => {
      try {
        const file = makeFile();
        if (!navigator.canShare?.({ files:[file] })) { download(); return; }
        await navigator.share({ files:[file] });
        status.textContent = 'Log shared.';
      } catch (error) {
        if (error?.name !== 'AbortError') status.textContent = 'Sharing unavailable. Use Download log.';
      }
    });
    dialog.querySelector('[data-diag="download"]').addEventListener('click', download);
    dialog.querySelector('[data-diag="close"]').addEventListener('click', () => dialog.close());
    button.addEventListener('click', () => {
      const launches = entries.filter(e => e.event === 'launch').length;
      dialog.querySelector('.diag-summary').textContent = `${app} · page loaded ${new Date(startedAt).toLocaleTimeString()} · ${launches} page load${launches === 1 ? '' : 's'} in retained log.${storageAvailable ? '' : ' Storage unavailable; export before leaving.'}`;
      const recent = operation => [...entries].reverse().find(e => e.event === 'sync-ack' && operation(e.operation));
      const write = recent(op => ['logExpense', 'deleteExpense', 'addCashWithdrawal', 'deleteCashWithdrawal'].includes(op));
      const read = recent(op => op === 'getAppState');
      dialog.querySelector('.diag-sync').textContent = `Last save acknowledgement: ${write ? (write.durationMs / 1000).toFixed(2) + 's' : 'not measured yet'}. Last data refresh: ${read ? (read.durationMs / 1000).toFixed(2) + 's' : 'not measured yet'}.`;
      dialog.querySelector('pre').textContent = entries.slice(-20).map(e => `${e.at.slice(11, 19)} ${e.event}${e.operation ? ` ${e.operation}` : ''}${e.durationMs != null ? ` ${(e.durationMs / 1000).toFixed(2)}s` : ''}${e.awayMs != null ? ` (${Math.round(e.awayMs / 1000)}s away)` : ''} · ${e.page === page ? 'current page' : 'earlier page'}`).join('\n');
      status.textContent = '';
      dialog.showModal();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
