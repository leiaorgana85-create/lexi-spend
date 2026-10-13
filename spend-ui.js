(() => {
  'use strict';

  const VIEW_KEY = 'lexiSpendActiveViewV1';
  const NOTES_KEY = 'lexiSpendGeneralNotesV1';

  const $ = id => document.getElementById(id);

  function addSectionTitle(parent, text, extraClass = '') {
    if (!parent || parent.querySelector(`:scope > .${extraClass || 'lexi-section-title'}`)) return;
    const title = document.createElement('div');
    title.className = `lexi-section-title${extraClass ? ` ${extraClass}` : ''}`;
    title.textContent = text;
    parent.insertBefore(title, parent.firstChild);
  }

  function buildNotesPage(app, pagerShell) {
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
        <button class="lexi-note-tool" type="button" data-note-date>Date</button>
      </div>
      <textarea id="lexiNotesEditor" class="lexi-notes-editor" spellcheck="true" placeholder="Write anything here — spending reminders, uncategorized items, app notes, trip expenses…"></textarea>
      <div class="lexi-notes-help">Plain notes are saved automatically on this device.</div>`;

    pagerShell.insertAdjacentElement('afterend', section);

    const editor = section.querySelector('#lexiNotesEditor');
    const status = section.querySelector('#lexiNotesStatus');
    let saveTimer = null;

    try {
      editor.value = localStorage.getItem(NOTES_KEY) || '';
    } catch (_) {}

    function setStatus(text) {
      status.textContent = text;
    }

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
      const lines = selectedBlock.split('\n');
      const replacement = lines.map((line, index) => formatter(line, index)).join('\n');

      editor.setRangeText(replacement, lineStart, lineEnd, 'select');
      editor.focus();
      scheduleSave();
    }

    section.querySelectorAll('[data-note-prefix]').forEach(button => {
      button.addEventListener('click', () => {
        const prefix = button.dataset.notePrefix || '';
        replaceSelectedLines(line => `${prefix}${line}`);
      });
    });

    section.querySelector('[data-note-numbered]').addEventListener('click', () => {
      replaceSelectedLines((line, index) => `${index + 1}. ${line}`);
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

    editor.addEventListener('input', scheduleSave);
    editor.addEventListener('blur', () => {
      clearTimeout(saveTimer);
      saveNotes();
    });

    setStatus(editor.value ? 'Saved' : '');
    return section;
  }

  function buildTabbar() {
    if (document.getElementById('lexiTabbar')) return document.getElementById('lexiTabbar');
    const nav = document.createElement('nav');
    nav.id = 'lexiTabbar';
    nav.className = 'lexi-tabbar';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
      <button class="lexi-tab active" type="button" data-lexi-view="spend">Spend</button>
      <button class="lexi-tab" type="button" data-lexi-view="cash">Cash</button>
      <button class="lexi-tab" type="button" data-lexi-view="notes">Notes</button>`;
    document.body.appendChild(nav);
    return nav;
  }

  function init() {
    const app = document.querySelector('.app');
    const pagerShell = $('pagerShell');
    const dotSpend = $('dotSpend');
    const dotCash = $('dotCash');
    if (!app || !pagerShell || !dotSpend || !dotCash) return;

    const title = document.querySelector('.titleLine h1');
    if (title) title.textContent = 'Lexi Spend';

    const expenseForm = $('expenseForm');
    const entryCard = expenseForm?.closest('.card');
    if (entryCard) {
      entryCard.classList.add('lexi-entry-card');
      addSectionTitle(entryCard, 'Log Spend');
    }

    const summaryCard = document.querySelector('.compactSummary');
    if (summaryCard) {
      addSectionTitle(summaryCard, 'This Stay');
      const recent = summaryCard.querySelector('.recentCompact');
      if (recent && !summaryCard.querySelector('.lexi-recent-title')) {
        const recentTitle = document.createElement('div');
        recentTitle.className = 'lexi-section-title lexi-recent-title';
        recentTitle.textContent = 'Recent Spend';
        recent.insertAdjacentElement('beforebegin', recentTitle);
      }
    }

    const cashCard = document.querySelector('section[aria-label="Cash Wallet"] .card');
    if (cashCard) {
      cashCard.classList.add('lexi-cash-card');
      const titleRow = cashCard.querySelector('.cashPageTitle');
      const balance = cashCard.querySelector('.cashBalanceBlock');
      if (titleRow && balance) titleRow.insertAdjacentElement('afterend', balance);
    }

    buildNotesPage(app, pagerShell);
    const tabbar = buildTabbar();
    const tabs = Array.from(tabbar.querySelectorAll('[data-lexi-view]'));

    function updateActiveTab(view) {
      const safeView = ['spend', 'cash', 'notes'].includes(view) ? view : 'spend';
      document.body.dataset.lexiView = safeView;
      tabs.forEach(tab => {
        const active = tab.dataset.lexiView === safeView;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-current', active ? 'page' : 'false');
      });
      try { localStorage.setItem(VIEW_KEY, safeView); } catch (_) {}
    }

    function showView(view) {
      if (view === 'cash') {
        dotCash.click();
        updateActiveTab('cash');
        return;
      }
      if (view === 'notes') {
        updateActiveTab('notes');
        return;
      }
      dotSpend.click();
      updateActiveTab('spend');
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => showView(tab.dataset.lexiView));
    });

    const pagerObserver = new MutationObserver(() => {
      if (document.body.dataset.lexiView === 'notes') return;
      updateActiveTab(dotCash.classList.contains('active') ? 'cash' : 'spend');
    });
    pagerObserver.observe(dotSpend, { attributes: true, attributeFilter: ['class'] });
    pagerObserver.observe(dotCash, { attributes: true, attributeFilter: ['class'] });

    let initialView = 'spend';
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (['spend', 'cash', 'notes'].includes(saved)) initialView = saved;
    } catch (_) {}
    showView(initialView);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
