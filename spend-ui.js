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
        <button class="lexi-note-tool" type="button" data-note-prefix="☐ ">☐ Check</button>
        <button class="lexi-note-tool" type="button" data-note-indent>↳ Indent</button>
        <button class="lexi-note-tool" type="button" data-note-undo>↶ Undo</button>
        <button class="lexi-note-tool" type="button" data-note-redo>↷ Redo</button>
        <button class="lexi-note-tool" type="button" data-note-date>Date</button>
      </div>
      <textarea id="lexiNotesEditor" class="lexi-notes-editor" spellcheck="true" aria-label="Notes"></textarea>
      <div class="lexi-notes-help">Saved automatically on this device.</div>`;

    anchor.insertAdjacentElement('afterend', section);

    const editor = section.querySelector('#lexiNotesEditor');
    const status = section.querySelector('#lexiNotesStatus');
    let saveTimer = null;

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

    function replaceSelectedLines(formatter) {
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
      button.addEventListener('click', () => replaceSelectedLines(line => `${button.dataset.notePrefix || ''}${line}`));
    });
    section.querySelector('[data-note-numbered]').addEventListener('click', () => {
      replaceSelectedLines((line, index) => `${index + 1}. ${line}`);
    });
    section.querySelector('[data-note-indent]').addEventListener('click', () => {
      replaceSelectedLines(line => `  ${line}`);
    });
    section.querySelector('[data-note-date]').addEventListener('click', () => {
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const start = editor.selectionStart;
      const insertion = `${start > 0 && editor.value[start - 1] !== '\n' ? '\n' : ''}${iso} — `;
      editor.setRangeText(insertion, start, editor.selectionEnd, 'end');
      editor.focus();
      scheduleSave();
    });

    function historyCommand(command) {
      editor.focus();
      try { document.execCommand(command); } catch (_) {}
      scheduleSave();
    }
    section.querySelector('[data-note-undo]').addEventListener('click', () => historyCommand('undo'));
    section.querySelector('[data-note-redo]').addEventListener('click', () => historyCommand('redo'));

    editor.addEventListener('input', scheduleSave);
    editor.addEventListener('blur', () => {
      clearTimeout(saveTimer);
      saveNotes();
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

  function init() {
    const pagerShell = $('pagerShell');
    const dotSpend = $('dotSpend');
    const dotCash = $('dotCash');
    if (!pagerShell || !dotSpend || !dotCash) return;

    const title = document.querySelector('.titleLine h1');
    if (title) title.innerHTML = 'Lexi Spend <span class="lexi-title-icon" aria-hidden="true">💳</span>';

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

    const stayMini = $('stayMini');
    buildLimitPage(pagerShell, stayMini, summaryCard);
    buildNotesPage($('lexiLimitPage'));

    const tabbar = buildTabbar();
    const tabs = Array.from(tabbar.querySelectorAll('[data-lexi-view]'));

    pagerShell.addEventListener('touchend', () => {
      const lockedView = document.body.dataset.lexiView;
      if (lockedView === 'spend' && dotCash.classList.contains('active')) dotSpend.click();
      else if (lockedView === 'cash' && dotSpend.classList.contains('active')) dotCash.click();
    }, { passive: true });

    function persistView(view) {
      try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    }
    function updateTabs(view) {
      tabs.forEach(tab => {
        const active = tab.dataset.lexiView === view;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-current', active ? 'page' : 'false');
      });
    }
    function showView(requestedView) {
      const view = VALID_VIEWS.includes(requestedView) ? requestedView : 'spend';
      if (view === 'spend') dotSpend.click();
      else if (view === 'cash') dotCash.click();
      document.body.dataset.lexiView = view;
      updateTabs(view);
      persistView(view);
      if (view === 'limit') updateLimitVisuals();
    }

    tabs.forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.lexiView)));

    const budgetObserver = new MutationObserver(updateLimitVisuals);
    const budgetRows = $('budgetRows');
    const budgetTotal = $('budgetTotal');
    if (budgetRows) budgetObserver.observe(budgetRows, { childList: true, subtree: true, characterData: true });
    if (budgetTotal) budgetObserver.observe(budgetTotal, { childList: true, subtree: true, characterData: true });
    updateLimitVisuals();

    let initialView = 'spend';
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (VALID_VIEWS.includes(saved)) initialView = saved;
    } catch (_) {}
    showView(initialView);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
