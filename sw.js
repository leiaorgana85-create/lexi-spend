const CACHE = 'lexi-spend-v32';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './bridge-state.js',
  './bridge-auth.js',
  './bridge-call.js',
  './bridge-runtime.js',
  './bridge-settings.js',
  './spend-ui.css',
  './spend-ui.js',
  './payload/part1a.txt',
  './payload/part1b.txt',
  './payload/part2a.txt',
  './payload/part2b.txt',
  './payload/part3aa.txt',
  './payload/part3ab.txt',
  './payload/part3b.txt',
  './payload/part4a.txt',
  './payload/part4b.txt',
  './payload/part5a.txt',
  './payload/part5b.txt'
];

const UI_PATCH = String.raw`
;(() => {
  if (document.getElementById('lexiSpendUiRefineV32')) return;

  const style = document.createElement('style');
  style.id = 'lexiSpendUiRefineV32';
  style.textContent = [
    'html, body { width:100% !important; max-width:100% !important; overflow-x:hidden !important; }',
    '.app { width:100% !important; max-width:600px !important; margin-left:auto !important; margin-right:auto !important; overflow-x:hidden !important; }',
    '.top, .titleLine, #pagerShell, .lexi-limit-page, .lexi-notes-page { max-width:100% !important; }',
    '.top { min-height:44px !important; margin:0 -1px 6px !important; padding:2px 1px 7px !important; }',
    '.titleLine { width:100% !important; min-height:34px !important; align-items:center !important; }',
    '.lexi-header-left { flex:0 0 auto !important; margin-right:6px !important; gap:1px !important; }',
    '.lexi-header-left h1 { font-size:15.5px !important; line-height:1 !important; font-weight:780 !important; letter-spacing:-0.015em !important; }',
    '.lexi-title-icon { font-size:14px !important; line-height:1 !important; }',
    '.lexi-header-left .gear { flex:0 0 28px !important; width:28px !important; height:28px !important; min-width:28px !important; min-height:28px !important; margin:0 !important; }',
    '.lexi-header-converter { margin-left:auto !important; margin-right:0 !important; flex:0 0 auto !important; display:flex !important; align-items:center !important; justify-content:flex-end !important; gap:0 !important; padding:2px 4px !important; border:1px solid var(--line) !important; border-radius:10px !important; background:var(--card) !important; box-sizing:border-box !important; }',
    '.lexi-converter-symbol { flex:0 0 auto !important; margin-right:2px !important; font-size:14px !important; line-height:1 !important; color:var(--muted) !important; }',
    '.lexi-converter-input { width:86px !important; height:28px !important; min-height:28px !important; border:0 !important; border-radius:7px !important; background:var(--field) !important; padding:2px 6px !important; }',
    '.lexi-converter-arrow { flex:0 0 auto !important; margin:0 4px !important; font-size:11px !important; color:var(--muted) !important; }',
    '.lexi-converter-output { flex:0 0 auto !important; min-width:49px !important; font-size:14px !important; line-height:1 !important; font-weight:800 !important; text-align:left !important; }',
    '#pagerShell .pageInner { box-sizing:border-box !important; padding-top:4px !important; }',
    '.lexi-limit-scroll { box-sizing:border-box !important; padding-top:4px !important; }',
    '.lexi-entry-card .row { margin-top:10px !important; }',
    '.lexi-entry-card #expenseForm > .row:first-child { margin-top:0 !important; }',
    '.lexi-entry-card .currencyPaymentRow { margin-top:10px !important; }',
    '.lexi-entry-card .amountFull { margin-top:10px !important; }',
    '.lexi-entry-card .dateBar { margin-top:10px !important; }',
    '.lexi-entry-card .noteToggle { padding-top:10px !important; }',
    '.lexi-entry-card .saveActionRow { margin-top:10px !important; }',
    '.lexi-recent-card { margin-top:13px !important; }',
    '.lexi-tabbar { border-top:1px solid var(--line) !important; background:#171a20 !important; padding:6px 8px calc(5px + env(safe-area-inset-bottom)) !important; box-shadow:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }',
    '.lexi-tab { min-height:47px !important; padding:7px 2px 2px !important; gap:3px !important; }',
    '.lexi-tab.active { background:transparent !important; color:var(--text) !important; }',
    '.lexi-cash-card .cashCurrencyField { flex:0 0 140px !important; width:140px !important; }',
    '.lexi-cash-card #addCashBtn { min-width:180px !important; width:180px !important; }',
    '.lexi-entry-card #merchant::placeholder { font-size:13px !important; }',
    '.lexi-entry-card .usdPreview:empty { display:none !important; min-height:0 !important; margin-top:0 !important; }',
    'body[data-lexi-view="notes"] .lexi-notes-page { flex:0 0 auto !important; width:calc(100% - 16px) !important; max-width:calc(100% - 16px) !important; min-width:0 !important; align-self:center !important; margin:4px auto 0 !important; padding:0 0 4px !important; overflow:hidden !important; }',
    '.lexi-notes-view, .lexi-notes-editor { flex:0 0 auto !important; width:100% !important; height:min(52dvh, 480px) !important; max-height:min(52dvh, 480px) !important; overflow-x:hidden !important; overflow-y:auto !important; scrollbar-width:none !important; }',
    '.lexi-notes-editor { font-size:16px !important; line-height:1.3 !important; }',
    '.lexi-notes-view::-webkit-scrollbar, .lexi-notes-editor::-webkit-scrollbar { display:none !important; }',
    '.lexi-notes-tools[hidden] { display:none !important; }',
    '.lexi-notes-head { align-items:center !important; margin-bottom:6px !important; }',
    '.lexi-notes-mode-actions { display:flex; align-items:center; justify-content:flex-end; gap:7px; min-width:0; }',
    '.lexi-notes-mode-btn { min-width:44px; height:26px; border:1px solid var(--line); border-radius:7px; background:var(--card); color:var(--text); padding:0 8px; font-size:10.5px; font-weight:750; }',
    '.lexi-notes-help { margin-top:5px !important; }',
    '.lexi-notes-check-row { display:grid !important; grid-template-columns:20px minmax(0,1fr) !important; align-items:start !important; gap:0 !important; min-height:1.38em !important; }',
    '.lexi-notes-check-row input[type="checkbox"] { -webkit-appearance:checkbox !important; appearance:auto !important; box-sizing:content-box !important; width:14px !important; height:14px !important; min-width:0 !important; min-height:0 !important; margin:1px 0 0 1px !important; padding:0 !important; border:initial !important; border-radius:initial !important; background:initial !important; display:block !important; }',
    '.lexi-notes-check-row input[type="checkbox"]:checked { background:initial !important; border-color:initial !important; }',
    '.lexi-notes-check-row input[type="checkbox"]:checked::after { content:none !important; }',
    '.lexi-notes-check-label { min-width:0 !important; line-height:1.38 !important; white-space:pre-wrap !important; overflow-wrap:anywhere !important; }',
    '.lexi-notes-check-row input[type="checkbox"]:checked + .lexi-notes-check-label { text-decoration:line-through; opacity:.58; }',
    '.lexi-notes-check-indent { display:none !important; }',
    '@media (max-width:370px) { .lexi-header-left { margin-right:4px !important; } .lexi-header-left h1 { font-size:14.5px !important; } .lexi-header-left .gear { flex-basis:26px !important; width:26px !important; height:26px !important; min-width:26px !important; min-height:26px !important; } .lexi-header-converter { padding:2px 3px !important; } .lexi-converter-input { width:70px !important; } .lexi-converter-output { min-width:43px !important; font-size:13px !important; } .lexi-cash-card .cashCurrencyField { flex-basis:132px !important; width:132px !important; } .lexi-cash-card #addCashBtn { min-width:170px !important; width:170px !important; } .lexi-tab { min-height:46px !important; } }'
  ].join('\n');
  document.head.appendChild(style);

  function fixHeader() {
    const titleLine = document.querySelector('.titleLine');
    const left = titleLine?.querySelector('.lexi-header-left');
    const gear = document.querySelector('.gear');
    if (left && gear && gear.parentElement !== left) left.appendChild(gear);
  }

  function refineSpendPreview() {
    const preview = document.getElementById('usdPreview');
    if (!preview) return;
    const text = String(preview.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (
      text === 'enter an amount to preview estimated usd.' ||
      text === 'enter an amount to preview estimated usd' ||
      text === 'enter an amount to preview usd.' ||
      text === 'enter an amount to preview usd'
    ) {
      preview.textContent = '';
    }
  }

  function notesParts() {
    const section = document.getElementById('lexiNotesPage');
    if (!section) return null;
    return {
      section,
      head: section.querySelector('.lexi-notes-head'),
      status: section.querySelector('#lexiNotesStatus'),
      tools: section.querySelector('.lexi-notes-tools'),
      editor: section.querySelector('#lexiNotesEditor'),
      view: section.querySelector('#lexiNotesView')
    };
  }

  function renderRead(parts) {
    const { editor, view } = parts;
    if (!editor || !view) return;
    view.replaceChildren();
    const lines = String(editor.value || '').split('\n');

    lines.forEach((line, index) => {
      const check = line.match(/^(\s*)\[( |x|X)\]\s*(.*)$/);
      if (check) {
        const row = document.createElement('div');
        row.className = 'lexi-notes-check-row';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = String(check[2]).toLowerCase() === 'x';
        input.setAttribute('aria-label', check[3] || 'Checklist item ' + (index + 1));

        const label = document.createElement('span');
        label.className = 'lexi-notes-check-label';
        label.textContent = check[3] || '';

        input.addEventListener('click', event => {
          event.stopPropagation();
          const currentLines = String(editor.value || '').split('\n');
          if (index >= currentLines.length) return;
          currentLines[index] = currentLines[index].replace(
            /^(\s*)\[(?: |x|X)\]/,
            '$1[' + (input.checked ? 'x' : ' ') + ']'
          );
          editor.value = currentLines.join('\n');
          editor.dispatchEvent(new Event('input', { bubbles:true }));
          renderRead(parts);
        });

        row.append(input, label);
        view.appendChild(row);
        return;
      }

      const row = document.createElement('div');
      row.className = 'lexi-notes-view-line';
      row.textContent = line || '\u00a0';
      view.appendChild(row);
    });
  }

  function showRead(parts) {
    if (!parts?.editor || !parts?.view) return;
    renderRead(parts);
    parts.editor.hidden = true;
    parts.view.hidden = false;
    if (parts.tools) parts.tools.hidden = true;
    parts.section.dataset.lexiNotesMode = 'read';
    const button = parts.section.querySelector('.lexi-notes-mode-btn');
    if (button) button.textContent = 'Edit';
  }

  function showEdit(parts) {
    if (!parts?.editor || !parts?.view) return;
    parts.view.hidden = true;
    parts.editor.hidden = false;
    if (parts.tools) parts.tools.hidden = false;
    parts.section.dataset.lexiNotesMode = 'edit';
    const button = parts.section.querySelector('.lexi-notes-mode-btn');
    if (button) button.textContent = 'Done';
  }

  function resetViewportX() {
    const top = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    window.scrollTo(0, top);
  }

  function settleViewportX() {
    resetViewportX();
    requestAnimationFrame(resetViewportX);
    setTimeout(resetViewportX, 80);
    setTimeout(resetViewportX, 320);
  }

  function setupNotes() {
    const parts = notesParts();
    if (!parts || !parts.head || !parts.editor || !parts.view) return;

    if (!parts.section.querySelector('.lexi-notes-mode-btn')) {
      const actions = document.createElement('div');
      actions.className = 'lexi-notes-mode-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lexi-notes-mode-btn';
      button.textContent = 'Edit';
      button.setAttribute('aria-label', 'Edit note');

      if (parts.status) actions.appendChild(parts.status);
      actions.appendChild(button);
      parts.head.appendChild(actions);

      button.addEventListener('click', () => {
        if (parts.section.dataset.lexiNotesMode === 'edit') {
          parts.editor.blur();
          showRead(parts);
          settleViewportX();
        } else {
          showEdit(parts);
        }
      });
    }

    if (!parts.view.dataset.lexiReadGuard) {
      parts.view.dataset.lexiReadGuard = '1';
      parts.view.addEventListener('click', event => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }

    const notesTab = document.querySelector('[data-lexi-view="notes"]');
    if (notesTab && !notesTab.dataset.lexiReadDefault) {
      notesTab.dataset.lexiReadDefault = '1';
      notesTab.addEventListener('click', () => queueMicrotask(() => showRead(notesParts())));
    }

    if (!parts.editor.dataset.lexiViewportGuard) {
      parts.editor.dataset.lexiViewportGuard = '1';
      parts.editor.addEventListener('blur', settleViewportX);
    }

    const tabbar = document.getElementById('lexiTabbar');
    if (tabbar && !tabbar.dataset.lexiViewportGuard) {
      tabbar.dataset.lexiViewportGuard = '1';
      tabbar.addEventListener('click', event => {
        const tab = event.target.closest?.('[data-lexi-view]');
        if (!tab) return;
        const currentEditor = document.getElementById('lexiNotesEditor');
        if (currentEditor && document.activeElement === currentEditor) currentEditor.blur();
        settleViewportX();
      }, true);
    }

    showRead(parts);
    settleViewportX();
  }

  document.addEventListener('keydown', event => {
    const editor = event.target;
    if (!(editor instanceof HTMLTextAreaElement) || editor.id !== 'lexiNotesEditor') return;
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (editor.selectionStart !== editor.selectionEnd) return;

    const text = editor.value;
    const caret = editor.selectionStart;
    const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
    let lineEnd = text.indexOf('\n', caret);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    const match = line.match(/^(\s*)(•\s+|\[(?: |x|X)\]\s+|(\d+)\.\s+)(.*)$/);
    if (!match) return;

    const indent = match[1] || '';
    const prefix = match[2] || '';
    const number = match[3] ? Number(match[3]) : null;
    const content = match[4] || '';

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!content.trim() && caret >= lineStart + indent.length + prefix.length) {
      editor.value = text.slice(0, lineStart) + indent + text.slice(lineEnd);
      const nextCaret = lineStart + indent.length;
      editor.setSelectionRange(nextCaret, nextCaret);
    } else {
      let nextPrefix = prefix;
      if (/^\[(?: |x|X)\]\s+/.test(prefix)) nextPrefix = '[ ] ';
      if (number !== null) nextPrefix = String(number + 1) + '. ';
      const insertion = '\n' + indent + nextPrefix;
      editor.value = text.slice(0, caret) + insertion + text.slice(caret);
      const nextCaret = caret + insertion.length;
      editor.setSelectionRange(nextCaret, nextCaret);
    }

    editor.dispatchEvent(new Event('input', { bubbles:true }));
  }, true);

  const run = () => {
    fixHeader();
    refineSpendPreview();
    setupNotes();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    queueMicrotask(run);
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fixHeader();
      refineSpendPreview();
      if (!document.querySelector('.lexi-notes-mode-btn')) setupNotes();
    });
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
})();
`;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isUiJs = url.pathname.endsWith('/spend-ui.js');
  const forceFreshUi = isUiJs || url.pathname.endsWith('/spend-ui.css');
  const forceFreshDocument = request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/lexi-spend/');
  const networkRequest = (forceFreshUi || forceFreshDocument)
    ? new Request(request, { cache: 'no-store' })
    : request;

  event.respondWith(
    fetch(networkRequest)
      .then(async response => {
        let finalResponse = response;

        if (response.ok && isUiJs) {
          const text = await response.text();
          finalResponse = new Response(text + UI_PATCH, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }

        if (finalResponse.ok) {
          const copy = finalResponse.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return finalResponse;
      })
      .catch(() => caches.match(request))
  );
});