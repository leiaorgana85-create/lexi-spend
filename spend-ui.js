(() => {
  'use strict';

  const VIEW_KEY = 'lexiSpendActiveViewV2';
  const NOTES_KEY = 'lexiSpendGeneralNotesV1';
  const VALID_VIEWS = ['spend', 'stay', 'cash', 'notes'];

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
        <button class="lexi-note-tool" type="button" data-note-date>Date</button>
      </div>
      <textarea id="lexiNotesEditor" class="lexi-notes-editor" spellcheck="true" placeholder="Write anything here — spending reminders, uncategorized items, app notes, trip expenses…"></textarea>
      <div class="lexi-notes-help">Saved automatically on this device.</div>`;

    anchor.insertAdjacentElement('afterend', section);

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

  function buildStayPage(pagerShell, stayMini, summaryCard) {
    let section = document.getElementById('lexiStayPage');
    if (section) return section;

    section = document.createElement('section');
    section.id = 'lexiStayPage';
    section.className = 'lexi-stay-page';
    section.setAttribute('aria-label', 'This Stay');

    const scroll = document.createElement('div');
    scroll.className = 'lexi-stay-scroll';
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
      <button class="lexi-tab" type="button" data-lexi-view="stay">Stay</button>
      <button class="lexi-tab" type="button" data-lexi-view="cash">ATM</button>
      <button class="lexi-tab" type="button" data-lexi-view="notes">Notes</button>`;
    document.body.appendChild(nav);
    return nav;
  }

  function init() {
    const pagerShell = $('pagerShell');
    const dotSpend = $('dotSpend');
    const dotCash = $('dotCash');
    if (!pagerShell || !dotSpend || !dotCash) return;

    const title = document.querySelector('.titleLine h1');
    if (title) {
      title.innerHTML = 'Lexi Spend <span class="lexi-title-icon" aria-hidden="true">💳</span>';
    }

    const expenseForm = $('expenseForm');
    const entryCard = expenseForm?.closest('.card');
    if (entryCard) entryCard.classList.add('lexi-entry-card');

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

    const stayMini = $('stayMini');
    buildStayPage(pagerShell, stayMini, summaryCard);
    buildNotesPage($('lexiStayPage'));

    const tabbar = buildTabbar();
    const tabs = Array.from(tabbar.querySelectorAll('[data-lexi-view]'));

    // The original app still owns a Spend/Cash swipe handler. Keep touch
    // events available to form controls, but immediately restore the tab the
    // user selected if an incidental horizontal gesture tries to change it.
    pagerShell.addEventListener('touchend', () => {
      const lockedView = document.body.dataset.lexiView;
      if (lockedView === 'spend' && dotCash.classList.contains('active')) {
        dotSpend.click();
      } else if (lockedView === 'cash' && dotSpend.classList.contains('active')) {
        dotCash.click();
      }
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

      if (view === 'spend') {
        dotSpend.click();
      } else if (view === 'cash') {
        dotCash.click();
      }

      document.body.dataset.lexiView = view;
      updateTabs(view);
      persistView(view);
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => showView(tab.dataset.lexiView));
    });

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
