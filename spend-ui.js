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

  function buildNotesPage(pagerShell) {
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

  function buildNotesDot(pageNav) {
    let dot = document.getElementById('dotNotes');
    if (dot) return dot;

    dot = document.createElement('span');
    dot.id = 'dotNotes';
    dot.className = 'dot';
    dot.setAttribute('role', 'button');
    dot.setAttribute('tabindex', '0');
    dot.setAttribute('aria-label', 'Notes');
    pageNav.appendChild(dot);
    return dot;
  }

  function init() {
    const pagerShell = $('pagerShell');
    const pageNav = document.querySelector('.pageNav');
    const dotSpend = $('dotSpend');
    const dotCash = $('dotCash');
    if (!pagerShell || !pageNav || !dotSpend || !dotCash) return;

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

    const notesPage = buildNotesPage(pagerShell);
    const dotNotes = buildNotesDot(pageNav);

    function persistView(view) {
      try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    }

    function setViewState(view) {
      const safeView = ['spend', 'cash', 'notes'].includes(view) ? view : 'spend';
      document.body.dataset.lexiView = safeView;
      dotNotes.classList.toggle('active', safeView === 'notes');
      dotNotes.setAttribute('aria-current', safeView === 'notes' ? 'page' : 'false');
      persistView(safeView);
    }

    function showView(view) {
      if (view === 'notes') {
        document.body.dataset.lexiView = 'notes';
        dotSpend.classList.remove('active');
        dotCash.classList.remove('active');
        dotNotes.classList.add('active');
        dotNotes.setAttribute('aria-current', 'page');
        persistView('notes');
        return;
      }

      dotNotes.classList.remove('active');
      dotNotes.setAttribute('aria-current', 'false');

      if (view === 'cash') {
        document.body.dataset.lexiView = 'cash';
        dotCash.click();
        setViewState('cash');
        return;
      }

      document.body.dataset.lexiView = 'spend';
      dotSpend.click();
      setViewState('spend');
    }

    dotSpend.addEventListener('click', () => setViewState('spend'));
    dotCash.addEventListener('click', () => setViewState('cash'));
    dotNotes.addEventListener('click', () => showView('notes'));
    dotNotes.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showView('notes');
      }
    });

    const pagerObserver = new MutationObserver(() => {
      if (document.body.dataset.lexiView === 'notes') return;
      setViewState(dotCash.classList.contains('active') ? 'cash' : 'spend');
    });
    pagerObserver.observe(dotSpend, { attributes: true, attributeFilter: ['class'] });
    pagerObserver.observe(dotCash, { attributes: true, attributeFilter: ['class'] });

    let swipeStartX = null;
    let swipeStartY = null;

    function onTouchStart(event) {
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
    }

    function onTouchEnd(event) {
      if (swipeStartX === null || swipeStartY === null) return;
      const touch = event.changedTouches?.[0];
      if (!touch) return;

      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;
      swipeStartX = null;
      swipeStartY = null;

      if (Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy)) return;

      const current = document.body.dataset.lexiView || 'spend';
      if (current === 'cash' && dx < 0) {
        showView('notes');
      } else if (current === 'notes' && dx > 0) {
        showView('cash');
      }
    }

    pagerShell.addEventListener('touchstart', onTouchStart, { passive: true });
    pagerShell.addEventListener('touchend', onTouchEnd, { passive: true });
    notesPage.addEventListener('touchstart', onTouchStart, { passive: true });
    notesPage.addEventListener('touchend', onTouchEnd, { passive: true });

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
