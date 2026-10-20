(() => {
  'use strict';

  const VIEW_KEY = 'lexiSpendActiveViewV3';
  const NOTES_KEY = 'lexiSpendGeneralNotesV1';
  const VALID_VIEWS = ['spend', 'limit', 'cash', 'notes'];
  const $ = id => document.getElementById(id);

  function addSectionTitle(parent, text, extraClass = '') {
    if (!parent || parent.querySelector(`:scope > .${extraClass || 'lexi-section-title'}`)) return;
    const title = document.createElement('div');
    title.className = `lexi-section-title${extraClass ? ` ${extraClass}` : ''}`;
    title.textContent = text;
    parent.insertBefore(title, parent.firstChild);
  }

  function replacePhrase(root, phrase, replacement) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (node.nodeValue && node.nodeValue.includes(phrase)) {
        node.nodeValue = node.nodeValue.split(phrase).join(replacement);
      }
    });
  }

  function buildNotesPage(anchor) {
    if (document.getElementById('lexiNotesPage')) return document.getElementById('lexiNotesPage');

    const section = document.createElement('section');
    section.id = 'lexiNotesPage';
    section.className = 'lexi-notes-page';
    section.setAttribute('aria-label', 'Notes');
    section.innerHTML = `
      <div class="lexi-notes-head">
        <h2 class="lexi-notes-title">Notes</h2>
        <div id="lexiNotesStatus" class="lexi-notes-status" aria-live="polite"></div>
      </div>
      <div class="lexi-notes-tools" aria-label="Plain text tools">
        <button class="lexi-note-tool" type="button" data-note-prefix="• ">• Bullet</button>
        <button class="lexi-note-tool" type="button" data-note-numbered>1. Number</button>
        <button class="lexi-note-tool" type="button" data-note-prefix="☐ " data-note-check>☐ Check</button>
        <button class="lexi-note-tool" type="button" data-note-indent>↳ Indent</button>
        <button class="lexi-note-tool" type="button" data-note-outdent aria-label="Outdent" title="Outdent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10M6 9l-3 3 3 3M3 12h5"/></svg></button>
        <button class="lexi-note-tool" type="button" data-note-undo>↶ Undo</button>
        <button class="lexi-note-tool" type="button" data-note-redo>↷ Redo</button>
        <button class="lexi-note-tool" type="button" data-note-date>Date</button>
      </div>
      <textarea id="lexiNotesEditor" class="lexi-notes-editor" spellcheck="true" aria-label="Notes"></textarea>
      <div id="lexiNotesView" class="lexi-notes-view" aria-label="Notes read view" hidden></div>
      <div class="lexi-notes-help">Saved automatically on this device.</div>`;

    anchor.insertAdjacentElement('afterend', section);

    const editor = section.querySelector('#lexiNotesEditor');
    const view = section.querySelector('#lexiNotesView');
    const status = section.querySelector('#lexiNotesStatus');
    let saveTimer = null;

    if (!document.getElementById('lexiNotesChecklistStyles')) {
      const style = document.createElement('style');
      style.id = 'lexiNotesChecklistStyles';
      style.textContent = `
        .lexi-notes-view {
          flex:1 1 auto;
          width:100%;
          max-width:100%;
          min-width:0;
          min-height:0;
          box-sizing:border-box;
          overflow-x:hidden;
          overflow-y:auto;
          overscroll-behavior-x:none;
          overscroll-behavior-y:contain;
          touch-action:pan-y;
          scrollbar-width:none;
          border:1px solid var(--line);
          border-radius:11px;
          background:var(--field);
          color:var(--text);
          padding:10px;
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          font-size:15px;
          line-height:1.45;
          white-space:pre-wrap;
          overflow-wrap:anywhere;
        }
        .lexi-notes-view::-webkit-scrollbar { display:none; }
        .lexi-notes-view[hidden] { display:none !important; }
        .lexi-notes-view-line { min-height:1.45em; white-space:pre-wrap; }
        .lexi-notes-check-row {
          display:flex;
          align-items:flex-start;
          gap:6px;
          min-height:1.45em;
          white-space:normal;
        }
        .lexi-notes-check-row input[type="checkbox"] {
          -webkit-appearance:none !important;
          appearance:none !important;
          box-sizing:border-box !important;
          flex:0 0 13px !important;
          width:13px !important;
          height:13px !important;
          min-width:13px !important;
          min-height:13px !important;
          margin:4px 0 0 !important;
          padding:0 !important;
          border:1.5px solid var(--muted) !important;
          border-radius:3px !important;
          background:transparent !important;
          display:grid !important;
          place-content:center !important;
        }
        .lexi-notes-check-row input[type="checkbox"]:checked {
          background:#2563eb !important;
          border-color:#2563eb !important;
        }
        .lexi-notes-check-row input[type="checkbox"]:checked::after {
          content:'';
          width:6px;
          height:3px;
          border-left:1.5px solid #fff;
          border-bottom:1.5px solid #fff;
          transform:translateY(-1px) rotate(-45deg);
        }
        .lexi-notes-check-label {
          min-width:0;
          line-height:1.45;
          white-space:pre-wrap;
          overflow-wrap:anywhere;
        }
        .lexi-notes-check-indent { flex:0 0 auto; white-space:pre; }
      `;
      document.head.appendChild(style);
    }

    try { editor.value = localStorage.getItem(NOTES_KEY) || ''; } catch (_) {}

    function setStatus(text) { status.textContent = text; }
    function saveNotes() {
      try {
        localStorage.setItem(NOTES_KEY, editor.value);
        setStatus('Saved');
      } catch (_) {
        setStatus('Could not save');
      }
    }
    function scheduleSave() {
      setStatus('Saving…');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNotes, 250);
    }

    function renderNotesView() {
      view.replaceChildren();
      const lines = String(editor.value || '').split('\n');

      lines.forEach((line, index) => {
        const check = line.match(/^(\s*)\[( |x|X)\]\s*(.*)$/);
        if (check) {
          const row = document.createElement('div');
          row.className = 'lexi-notes-check-row';

          if (check[1]) {
            const indent = document.createElement('span');
            indent.className = 'lexi-notes-check-indent';
            indent.textContent = check[1];
            row.appendChild(indent);
          }

          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = String(check[2]).toLowerCase() === 'x';
          input.setAttribute('aria-label', check[3] || `Checklist item ${index + 1}`);

          const label = document.createElement('span');
          label.className = 'lexi-notes-check-label';
          label.textContent = check[3] || '';

          input.addEventListener('click', event => {
            event.stopPropagation();
            const currentLines = String(editor.value || '').split('\n');
            if (index >= currentLines.length) return;
            currentLines[index] = currentLines[index].replace(
              /^(\s*)\[(?: |x|X)\]/,
              `$1[${input.checked ? 'x' : ' '}]`
            );
            editor.value = currentLines.join('\n');
            clearTimeout(saveTimer);
            saveNotes();
            renderNotesView();
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

    function showReadView() {
      renderNotesView();
      editor.hidden = true;
      view.hidden = false;
    }

    function showEditor() {
      view.hidden = true;
      editor.hidden = false;
    }

    function replaceSelectedLines(formatter) {
      showEditor();
      const value = editor.value;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const nextNewline = value.indexOf('\n', end);
      const lineEnd = nextNewline === -1 ? value.length : nextNewline;
      const selectedBlock = value.slice(lineStart, lineEnd);
      const replacement = selectedBlock.split('\n').map((line, index) => formatter(line, index)).join('\n');
      editor.setRangeText(replacement, lineStart, lineEnd, 'select');
      editor.focus();
      scheduleSave();
    }

    section.querySelectorAll('[data-note-prefix]').forEach(button => {
      if (button.hasAttribute('data-note-check')) return;
      button.addEventListener('click', () => replaceSelectedLines(line => `${button.dataset.notePrefix || ''}${line}`));
    });
    section.querySelector('[data-note-check]').addEventListener('click', () => {
      replaceSelectedLines(line => `[ ] ${line}`);
    });
    section.querySelector('[data-note-numbered]').addEventListener('click', () => {
      replaceSelectedLines((line, index) => `${index + 1}. ${line}`);
    });
    section.querySelector('[data-note-indent]').addEventListener('click', () => {
      replaceSelectedLines(line => `  ${line}`);
    });
    section.querySelector('[data-note-outdent]').addEventListener('click', () => {
      replaceSelectedLines(line => {
        if (line.startsWith('  ')) return line.slice(2);
        if (line.startsWith(' ')) return line.slice(1);
        return line;
      });
    });
    section.querySelector('[data-note-date]').addEventListener('click', () => {
      showEditor();
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const start = editor.selectionStart;
      const insertion = `${start > 0 && editor.value[start - 1] !== '\n' ? '\n' : ''}${iso} — `;
      editor.setRangeText(insertion, start, editor.selectionEnd, 'end');
      editor.focus();
      scheduleSave();
    });

    function historyCommand(command) {
      showEditor();
      editor.focus();
      try { document.execCommand(command); } catch (_) {}
      scheduleSave();
    }
    section.querySelector('[data-note-undo]').addEventListener('click', () => historyCommand('undo'));
    section.querySelector('[data-note-redo]').addEventListener('click', () => historyCommand('redo'));

    editor.dataset.lexiAutoContinue = '1';
    editor.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const lineBeforeCaret = value.slice(lineStart, start);

      const check = lineBeforeCaret.match(/^(\s*)\[(?: |x|X)\]\s?(.*)$/);
      const bullet = lineBeforeCaret.match(/^(\s*)•\s?(.*)$/);
      const numbered = lineBeforeCaret.match(/^(\s*)(\d+)\.\s?(.*)$/);

      let nextPrefix = '';
      if (check) {
        nextPrefix = `${check[1]}[ ] `;
      } else if (bullet) {
        nextPrefix = `${bullet[1]}• `;
      } else if (numbered) {
        nextPrefix = `${numbered[1]}${Number(numbered[2]) + 1}. `;
      } else {
        return;
      }

      event.preventDefault();
      editor.setRangeText(`\n${nextPrefix}`, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles:true }));
    });

    view.addEventListener('click', () => {
      showEditor();
      editor.focus();
    });

    editor.addEventListener('input', scheduleSave);
    editor.addEventListener('focus', showEditor);
    editor.addEventListener('blur', () => {
      clearTimeout(saveTimer);
      saveNotes();
      setTimeout(() => {
        if (document.activeElement === editor) return;
        if (document.activeElement?.closest?.('.lexi-notes-tools')) return;
        showReadView();
      }, 0);
    });

    setStatus(editor.value ? 'Saved' : '');
    return section;
  }

  function buildLimitPage(pagerShell, stayMini, summaryCard) {
    let section = document.getElementById('lexiLimitPage');
    if (section) return section;

    section = document.createElement('section');
    section.id = 'lexiLimitPage';
    section.className = 'lexi-limit-page';
    section.setAttribute('aria-label', 'Limit');

    const scroll = document.createElement('div');
    scroll.className = 'lexi-limit-scroll';
    section.appendChild(scroll);
    if (stayMini) scroll.appendChild(stayMini);
    if (summaryCard) scroll.appendChild(summaryCard);
    pagerShell.insertAdjacentElement('afterend', section);
    return section;
  }

  function buildTabbar() {
    let nav = document.getElementById('lexiTabbar');
    if (nav) return nav;
    nav = document.createElement('nav');
    nav.id = 'lexiTabbar';
    nav.className = 'lexi-tabbar';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
      <button class="lexi-tab active" type="button" data-lexi-view="spend">Spend</button>
      <button class="lexi-tab" type="button" data-lexi-view="limit">Limit</button>
      <button class="lexi-tab" type="button" data-lexi-view="cash">ATM</button>
      <button class="lexi-tab" type="button" data-lexi-view="notes">Notes</button>`;
    document.body.appendChild(nav);
    return nav;
  }

  function parseMoneyPair(text) {
    const match = String(text || '').replace(/,/g, '').match(/\$([\d.]+)\s*\/\s*\$([\d.]+)/);
    if (!match) return null;
    const spent = Number(match[1]);
    const limit = Number(match[2]);
    if (!Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0) return null;
    return { ratio: spent / limit };
  }

  function levelForRatio(ratio) {
    if (ratio > 1) return 'over';
    if (ratio >= 0.8) return 'near';
    return 'ok';
  }

  function updateLimitVisuals() {
    replacePhrase($('lexiLimitPage'), 'This Stay', 'Current Period');

    const total = $('budgetTotal');
    const overall = $('lexiOverallProgress');
    if (total && overall) {
      const pair = parseMoneyPair(total.textContent);
      if (pair) {
        overall.dataset.level = levelForRatio(pair.ratio);
        overall.firstElementChild.style.width = `${Math.min(100, Math.max(0, pair.ratio * 100))}%`;
        total.classList.toggle('over', pair.ratio > 1);
      }
    }

    ($('budgetRows')?.querySelectorAll('.budgetRow') || []).forEach(row => {
      const value = row.querySelector('.budgetValue');
      if (!value) return;
      const pair = parseMoneyPair(value.textContent);
      let progress = row.querySelector('.lexi-budget-progress');
      if (!progress) {
        progress = document.createElement('div');
        progress.className = 'lexi-budget-progress';
        progress.innerHTML = '<span></span>';
        row.appendChild(progress);
      }
      if (!pair) {
        progress.classList.add('no-limit');
        return;
      }
      progress.classList.remove('no-limit');
      progress.dataset.level = levelForRatio(pair.ratio);
      progress.firstElementChild.style.width = `${Math.min(100, Math.max(0, pair.ratio * 100))}%`;
    });
  }

  function configureLegacyPagerAsTabs(pagerShell, spendPage, cashPage) {
    const track = pagerShell.querySelector('.pagerTrack');
    if (track) {
      track.style.setProperty('display', 'block', 'important');
      track.style.setProperty('width', '100%', 'important');
      track.style.setProperty('transform', 'none', 'important');
      track.style.setProperty('transition', 'none', 'important');
      track.style.setProperty('touch-action', 'pan-y', 'important');
    }

    [spendPage, cashPage].forEach(page => {
      if (!page) return;
      page.style.setProperty('width', '100%', 'important');
      page.style.setProperty('max-width', '100%', 'important');
      page.style.setProperty('flex', '0 0 100%', 'important');
      page.style.setProperty('touch-action', 'pan-y', 'important');
    });

    const pageNav = document.querySelector('.pageNav');
    if (pageNav) pageNav.remove();

    let startX = null;
    let startY = null;
    let blockingHorizontal = false;

    pagerShell.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      blockingHorizontal = false;
    }, { capture: true, passive: true });

    pagerShell.addEventListener('touchmove', event => {
      if (startX === null || startY === null) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!blockingHorizontal && Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy)) {
        blockingHorizontal = true;
      }
      if (!blockingHorizontal) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });

    const endGesture = event => {
      if (blockingHorizontal) event.stopImmediatePropagation();
      startX = null;
      startY = null;
      blockingHorizontal = false;
    };

    pagerShell.addEventListener('touchend', endGesture, { capture: true, passive: true });
    pagerShell.addEventListener('touchcancel', endGesture, { capture: true, passive: true });
  }

  function setLegacyPaneVisibility(view, spendPage, cashPage) {
    if (spendPage) spendPage.style.setProperty('display', view === 'spend' ? 'block' : 'none', 'important');
    if (cashPage) cashPage.style.setProperty('display', view === 'cash' ? 'block' : 'none', 'important');
  }

  function buildHeaderConverter() {
    const titleLine = document.querySelector('.titleLine');
    const title = titleLine?.querySelector('h1');
    if (!titleLine || !title || document.getElementById('lexiHeaderConverter')) return;

    const gear = titleLine.querySelector('.gear');
    const left = document.createElement('div');
    left.className = 'lexi-header-left';
    titleLine.insertBefore(left, titleLine.firstChild);
    left.appendChild(title);
    if (gear) left.appendChild(gear);

    const converter = document.createElement('div');
    converter.id = 'lexiHeaderConverter';
    converter.className = 'lexi-header-converter';
    converter.setAttribute('aria-label', 'Quick currency converter');
    converter.innerHTML = `
      <span class="lexi-converter-symbol" aria-hidden="true">฿</span>
      <input id="lexiConverterAmount" class="lexi-converter-input" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" aria-label="Amount to convert to US dollars" placeholder="0">
      <span class="lexi-converter-arrow" aria-hidden="true">→</span>
      <output id="lexiConverterUsd" class="lexi-converter-output" aria-live="polite">$—</output>`;
    titleLine.appendChild(converter);

    if (!document.getElementById('lexiHeaderConverterStyles')) {
      const style = document.createElement('style');
      style.id = 'lexiHeaderConverterStyles';
      style.textContent = `
        .titleLine {
          display:flex !important;
          align-items:center !important;
          justify-content:flex-start !important;
          gap:5px !important;
          min-width:0 !important;
        }
        .lexi-header-left {
          display:flex;
          align-items:center;
          flex:0 0 auto;
          gap:1px;
          min-width:0;
        }
        .lexi-header-left h1 { flex:0 0 auto; white-space:nowrap; }
        .lexi-header-left .gear {
          flex:0 0 27px;
          width:27px !important;
          height:27px !important;
          min-width:27px !important;
          min-height:27px !important;
          margin:0 !important;
        }
        .lexi-header-converter {
          margin-left:auto;
          min-width:0;
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap:3px;
          flex:0 1 auto;
          white-space:nowrap;
        }
        .lexi-converter-symbol {
          flex:0 0 auto;
          font-size:14px;
          line-height:1;
          color:var(--muted);
        }
        .lexi-converter-input {
          box-sizing:border-box;
          width:68px;
          min-width:0;
          height:28px;
          min-height:28px;
          border:1px solid var(--line);
          border-radius:8px;
          background:var(--field);
          color:var(--text);
          padding:2px 6px;
          text-align:right;
          font:700 16px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          outline:none;
        }
        .lexi-converter-input:focus { border-color:var(--muted); }
        .lexi-converter-arrow {
          flex:0 0 auto;
          color:var(--muted);
          font-size:11px;
        }
        .lexi-converter-output {
          flex:0 0 auto;
          min-width:48px;
          color:var(--text);
          font-size:14.5px;
          font-weight:800;
          text-align:right;
        }
        @media (max-width:360px) {
          .lexi-header-left { gap:0; }
          .lexi-header-left .gear {
            flex-basis:25px;
            width:25px !important;
            min-width:25px !important;
          }
          .lexi-converter-input { width:60px; }
          .lexi-converter-output { min-width:43px; font-size:14.5px; }
        }
      `;
      document.head.appendChild(style);
    }

    const input = converter.querySelector('#lexiConverterAmount');
    const output = converter.querySelector('#lexiConverterUsd');
    const symbol = converter.querySelector('.lexi-converter-symbol');
    const currencySelect = document.querySelector('.currencyPaymentRow .currencySelect');

    const rateToUsd = {
      USD: 1,
      THB: 0.029783,
      KRW: 0.00071,
      VND: 0.000038,
      JPY: 0.0066,
      EUR: 1.16,
      GBP: 1.34,
      MXN: 0.054,
      COP: 0.00026,
      BRL: 0.185,
      PEN: 0.295,
      CLP: 0.00105,
      ARS: 0.00067
    };
    const currencySymbols = {
      USD: '$', THB: '฿', KRW: '₩', VND: '₫', JPY: '¥',
      EUR: '€', GBP: '£', MXN: '$', COP: '$', BRL: 'R$', PEN: 'S/',
      CLP: '$', ARS: '$'
    };

    function currentCurrency() {
      return String(currencySelect?.value || 'THB').trim().toUpperCase();
    }

    function renderConversion() {
      const currency = currentCurrency();
      const rate = rateToUsd[currency];
      symbol.textContent = currencySymbols[currency] || currency;
      converter.title = rate
        ? `Approximate ${currency} to USD converter`
        : `${currency} quick conversion is not configured`;

      const raw = String(input.value || '').replace(/,/g, '').trim();
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount < 0 || !rate) {
        output.textContent = '$—';
        return;
      }
      output.textContent = `$${(amount * rate).toFixed(2)}`;
    }

    input.addEventListener('input', renderConversion);
    input.addEventListener('focus', () => {
      renderConversion();
      if (input.value) setTimeout(() => input.select(), 0);
    });
    input.addEventListener('blur', () => {
      const restoreHorizontalViewport = () => {
        const top = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
        document.documentElement.scrollLeft = 0;
        document.body.scrollLeft = 0;
        window.scrollTo(0, top);
      };
      restoreHorizontalViewport();
      requestAnimationFrame(restoreHorizontalViewport);
      setTimeout(restoreHorizontalViewport, 80);
      setTimeout(restoreHorizontalViewport, 320);
    });
    currencySelect?.addEventListener('change', renderConversion);
    renderConversion();
  }

  function init() {
    const pagerShell = $('pagerShell');
    if (!pagerShell) return;

    const title = document.querySelector('.titleLine h1');
    if (title) title.innerHTML = 'Lexi Spend <span class="lexi-title-icon" aria-hidden="true">💳</span>';
    buildHeaderConverter();

    const expenseForm = $('expenseForm');
    const entryCard = expenseForm?.closest('.card');
    if (entryCard) entryCard.classList.add('lexi-entry-card');

    const summaryCard = document.querySelector('.compactSummary');
    const recent = summaryCard?.querySelector('.recentCompact');
    if (summaryCard) {
      addSectionTitle(summaryCard, 'Limit');
      const budgetTitle = summaryCard.querySelector('.budgetTitle b');
      if (budgetTitle) budgetTitle.textContent = 'Spending Limit';

      const budgetEquivalent = $('budgetEquivalent');
      if (budgetEquivalent && !$('lexiOverallProgress')) {
        const progress = document.createElement('div');
        progress.id = 'lexiOverallProgress';
        progress.className = 'lexi-overall-progress';
        progress.innerHTML = '<span></span>';
        budgetEquivalent.insertAdjacentElement('afterend', progress);
      }
    }

    if (entryCard && recent) {
      const spendInner = entryCard.parentElement;
      const recentCard = document.createElement('section');
      recentCard.className = 'lexi-recent-card';
      recentCard.setAttribute('aria-label', 'Recent Spend');
      const recentTitle = document.createElement('div');
      recentTitle.className = 'lexi-recent-title';
      recentTitle.textContent = 'Recent Spend';
      recentCard.append(recentTitle, recent);
      spendInner.appendChild(recentCard);
    }

    const cashCard = document.querySelector('section[aria-label="Cash Wallet"] .card');
    if (cashCard) {
      cashCard.classList.add('lexi-cash-card');
      const titleRow = cashCard.querySelector('.cashPageTitle');
      const balance = cashCard.querySelector('.cashBalanceBlock');
      if (titleRow && balance) titleRow.insertAdjacentElement('afterend', balance);
    }

    const spendPage = entryCard?.closest('.page') || null;
    const cashPage = cashCard?.closest('.page') || null;
    configureLegacyPagerAsTabs(pagerShell, spendPage, cashPage);

    const stayMini = $('stayMini');
    buildLimitPage(pagerShell, stayMini, summaryCard);
    buildNotesPage($('lexiLimitPage'));

    const tabbar = buildTabbar();
    const tabs = Array.from(tabbar.querySelectorAll('[data-lexi-view]'));

    function updateTabs(view) {
      tabs.forEach(tab => {
        const active = tab.dataset.lexiView === view;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-current', active ? 'page' : 'false');
      });
    }
    function showView(requestedView) {
      const view = VALID_VIEWS.includes(requestedView) ? requestedView : 'spend';
      document.body.dataset.lexiView = view;
      setLegacyPaneVisibility(view, spendPage, cashPage);
      updateTabs(view);
      if (view === 'limit') updateLimitVisuals();
    }

    tabs.forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.lexiView)));

    const budgetObserver = new MutationObserver(updateLimitVisuals);
    const budgetRows = $('budgetRows');
    const budgetTotal = $('budgetTotal');
    const limitPage = $('lexiLimitPage');
    if (budgetRows) budgetObserver.observe(budgetRows, { childList: true, subtree: true, characterData: true });
    if (budgetTotal) budgetObserver.observe(budgetTotal, { childList: true, subtree: true, characterData: true });
    if (limitPage) budgetObserver.observe(limitPage, { childList: true, subtree: true, characterData: true });
    updateLimitVisuals();

    showView('spend');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();