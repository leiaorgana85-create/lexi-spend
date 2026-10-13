const CACHE = 'lexi-spend-v25';
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

const NOTES_PARITY_PATCH = `
;(() => {
  if (document.getElementById('lexiTravelNotesParityV1')) return;

  const style = document.createElement('style');
  style.id = 'lexiTravelNotesParityV1';
  style.textContent = ` + "`" + `
    .lexi-notes-check-row {
      display:grid !important;
      grid-template-columns:20px minmax(0,1fr) !important;
      align-items:start !important;
      gap:0 !important;
      min-height:1.38em !important;
    }
    .lexi-notes-check-row input[type="checkbox"] {
      -webkit-appearance:checkbox !important;
      appearance:auto !important;
      box-sizing:content-box !important;
      width:14px !important;
      height:14px !important;
      min-width:0 !important;
      min-height:0 !important;
      margin:1px 0 0 1px !important;
      padding:0 !important;
      border:initial !important;
      border-radius:initial !important;
      background:initial !important;
      display:block !important;
    }
    .lexi-notes-check-row input[type="checkbox"]:checked {
      background:initial !important;
      border-color:initial !important;
    }
    .lexi-notes-check-row input[type="checkbox"]:checked::after {
      content:none !important;
    }
    .lexi-notes-check-label {
      min-width:0 !important;
      line-height:1.38 !important;
      white-space:pre-wrap !important;
      overflow-wrap:anywhere !important;
    }
    .lexi-notes-check-indent { display:none !important; }
  ` + "`" + `;
  document.head.appendChild(style);

  document.addEventListener('keydown', event => {
    const editor = event.target;
    if (!(editor instanceof HTMLTextAreaElement) || editor.id !== 'lexiNotesEditor') return;
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (editor.selectionStart !== editor.selectionEnd) return;

    const text = editor.value;
    const caret = editor.selectionStart;
    const lineStart = text.lastIndexOf('\\n', Math.max(0, caret - 1)) + 1;
    let lineEnd = text.indexOf('\\n', caret);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    const match = line.match(/^(\\s*)(•\\s+|\\[(?: |x|X)\\]\\s+|(\\d+)\\.\\s+)(.*)$/);
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
      if (/^\\[(?: |x|X)\\]\\s+/.test(prefix)) nextPrefix = '[ ] ';
      if (number !== null) nextPrefix = ` + "`" + `\${number + 1}. ` + "`" + `;
      const insertion = ` + "`" + `\\n\${indent}\${nextPrefix}` + "`" + `;
      editor.value = text.slice(0, caret) + insertion + text.slice(caret);
      const nextCaret = caret + insertion.length;
      editor.setSelectionRange(nextCaret, nextCaret);
    }

    editor.dispatchEvent(new Event('input', { bubbles:true }));
  }, true);
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
  const networkRequest = forceFreshUi
    ? new Request(request, { cache: 'no-store' })
    : request;

  event.respondWith(
    fetch(networkRequest)
      .then(async response => {
        let finalResponse = response;

        if (response.ok && isUiJs) {
          const text = await response.text();
          finalResponse = new Response(text + NOTES_PARITY_PATCH, {
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
