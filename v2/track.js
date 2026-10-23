(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const symbols = { THB:'฿', KRW:'₩', VND:'₫', JPY:'¥', MXN:'MX$', USD:'$' };

  function localIsoDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function updateConverterSymbol() {
    const currency = $('expenseCurrency')?.value || 'THB';
    if ($('converterSymbol')) $('converterSymbol').textContent = symbols[currency] || currency;
  }

  function setPayment(value) {
    const method = value === 'Cash' ? 'Cash' : 'Card';
    if ($('paymentMethod')) $('paymentMethod').value = method;
    $('payCard')?.classList.toggle('active', method === 'Card');
    $('payCash')?.classList.toggle('active', method === 'Cash');
    $('payCard')?.setAttribute('aria-pressed', String(method === 'Card'));
    $('payCash')?.setAttribute('aria-pressed', String(method === 'Cash'));
  }

  function updateDateDisplay() {
    const value = $('expenseDate')?.value || localIsoDate();
    const today = localIsoDate();
    const d = new Date(`${value}T12:00:00`);
    const now = new Date();
    const options = { weekday:'short', month:'short', day:'numeric' };
    if (d.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    const formatted = d.toLocaleDateString(undefined, options);
    if ($('dateMain')) $('dateMain').textContent = value === today ? `Today · ${d.toLocaleDateString(undefined, { month:'short', day:'numeric' })}` : formatted;
  }

  function updateClearButtons() {
    $('clearMerchant')?.classList.toggle('show', Boolean($('merchant')?.value));
    $('clearAmount')?.classList.toggle('show', Boolean($('expenseAmount')?.value));
  }

  function setNoteOpen(open) {
    const box = $('noteBox');
    if (!box) return;
    box.hidden = !open;
    if ($('noteToggle')) $('noteToggle').textContent = open ? '− Hide note' : '+ Add note';
    if (open) setTimeout(() => $('expenseNote')?.focus(), 0);
  }

  function init() {
    const currency = $('expenseCurrency');
    if (!currency) return;

    updateConverterSymbol();
    updateDateDisplay();
    updateClearButtons();
    setPayment($('paymentMethod')?.value || 'Card');
    setNoteOpen(false);

    new MutationObserver(updateConverterSymbol).observe(currency, { childList:true, subtree:true });
    currency.addEventListener('change', updateConverterSymbol);

    $('payCard')?.addEventListener('click', () => setPayment('Card'));
    $('payCash')?.addEventListener('click', () => setPayment('Cash'));
    $('expenseDate')?.addEventListener('change', updateDateDisplay);
    $('noteToggle')?.addEventListener('click', () => setNoteOpen($('noteBox')?.hidden !== false));
    $('merchant')?.addEventListener('input', updateClearButtons);
    $('expenseAmount')?.addEventListener('input', updateClearButtons);

    $('clearMerchant')?.addEventListener('click', () => {
      $('merchant').value = '';
      updateClearButtons();
      $('merchant').focus();
    });
    $('clearAmount')?.addEventListener('click', () => {
      $('expenseAmount').value = '';
      updateClearButtons();
      $('expenseAmount').dispatchEvent(new Event('input', { bubbles:true }));
      $('expenseAmount').focus();
    });

    const status = $('expenseStatus');
    if (status) {
      new MutationObserver(() => {
        if (/^Saved/.test(status.textContent || '')) {
          updateClearButtons();
          if (!$('expenseNote')?.value) setNoteOpen(false);
        }
      }).observe(status, { childList:true, characterData:true, subtree:true });
    }
  }

  init();
})();

// Compact select menus; native form controls retain their existing values/events.
(() => {
  if (window.lexiSpendRefreshSelect) return;
  const controls = new WeakMap();
  let active = null;
  let sequence = 0;
  let typeText = '';
  let typeAt = 0;

  function sync(select) {
    const button = controls.get(select);
    if (!button) return;
    const labelNode = select.labels?.[0];
    const label = select.getAttribute('aria-label') || labelNode?.querySelector('span')?.textContent?.trim() ||
      (labelNode && !labelNode.contains(select) ? labelNode.textContent.trim() : '') || select.name || 'Choose';
    const text = select.options[select.selectedIndex]?.textContent || 'Choose';
    if (button.textContent !== text) button.textContent = text;
    if (button.disabled !== select.disabled) button.disabled = select.disabled;
    button.setAttribute('aria-label', `${label}: ${text}`);
    button.setAttribute('aria-required', String(select.required));
    if (active?.select === select) paint();
  }

  function close(restoreFocus = false) {
    if (!active) return;
    const {button, menu} = active;
    active = null;
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    menu.remove();
    if (restoreFocus && button.isConnected) button.focus({preventScroll: true});
  }

  function position() {
    if (!active) return;
    const {button, menu} = active;
    if (!button.isConnected || button.closest('.screen:not(.active)')) return close();
    const box = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const left = viewport?.offsetLeft || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    if (box.bottom < top || box.top > top + height) return close();
    const menuWidth = Math.min(Math.max(box.width, 132), 260, width - 16);
    menu.style.width = `${menuWidth}px`;
    menu.style.left = `${Math.max(left + 8, Math.min(box.left, left + width - menuWidth - 8))}px`;
    const below = top + height - box.bottom - 12;
    const above = box.top - top - 12;
    const useAbove = below < 160 && above > below;
    menu.style.maxHeight = `${Math.max(36, Math.min(224, useAbove ? above : below))}px`;
    menu.style.top = `${useAbove ? Math.max(top + 8, box.top - menu.offsetHeight - 4) : box.bottom + 4}px`;
  }

  function paint() {
    if (!active) return;
    const {select, button, menu, index} = active;
    [...menu.children].forEach((row, i) => {
      row.setAttribute('aria-selected', String(select.selectedIndex === i));
      row.classList.toggle('spend-select-current', i === index);
    });
    button.setAttribute('aria-activedescendant', `${menu.id}-${index}`);
  }

  function enabled(option) {
    return Boolean(option && !option.disabled && !option.closest?.('optgroup[disabled]'));
  }

  function choose(index) {
    if (!active || !enabled(active.select.options[index])) return;
    const {select} = active;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    sync(select);
    close(true);
    if (changed) {
      select.dispatchEvent(new Event('input', {bubbles: true}));
      select.dispatchEvent(new Event('change', {bubbles: true}));
    }
  }

  function open(select, button) {
    close();
    if (select.disabled || !select.options.length) return;
    button.focus({preventScroll: true});
    const menu = document.createElement('div');
    menu.id = button.getAttribute('aria-controls');
    menu.className = 'spend-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choices');
    [...select.options].forEach((option, index) => {
      const row = document.createElement('div');
      row.id = `${menu.id}-${index}`;
      row.className = 'spend-select-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-disabled', String(!enabled(option)));
      row.textContent = option.textContent;
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', event => { event.stopPropagation(); choose(index); });
      menu.append(row);
    });
    (button.closest('dialog[open]') || document.body).append(menu);
    const firstEnabled = [...select.options].findIndex(enabled);
    if (firstEnabled < 0) { menu.remove(); return; }
    active = {select, button, menu, index: enabled(select.options[select.selectedIndex]) ? select.selectedIndex : firstEnabled};
    button.setAttribute('aria-expanded', 'true');
    typeText = '';
    paint();
    position();
  }

  function keydown(event, select, button) {
    const key = event.key;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
      event.preventDefault();
      if (active?.button !== button) { open(select, button); return; }
      if (key === 'Enter' || key === ' ') { choose(active.index); return; }
      const indexes = [...select.options].map((option, i) => enabled(option) ? i : -1).filter(i => i >= 0);
      const at = indexes.indexOf(active.index);
      if (key === 'Home') active.index = indexes[0];
      else if (key === 'End') active.index = indexes[indexes.length - 1];
      else active.index = indexes[Math.max(0, Math.min(indexes.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))];
      paint();
      active.menu.children[active.index]?.scrollIntoView?.({block: 'nearest'});
    } else if (key === 'Escape' && active?.button === button) {
      event.preventDefault(); close(true);
    } else if (key === 'Tab') close();
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (active?.button !== button) open(select, button);
      if (!active) return;
      typeText = Date.now() - typeAt < 600 ? typeText + key.toLowerCase() : key.toLowerCase();
      typeAt = Date.now();
      const index = [...select.options].findIndex(option => enabled(option) && option.textContent.toLowerCase().startsWith(typeText));
      if (index >= 0) { active.index = index; paint(); }
    }
  }

  function upgrade(select) {
    if (select.multiple || select.size > 1) return;
    if (controls.has(select)) { sync(select); return; }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `spend-select-button${/Currency$/.test(select.id) ? ' spend-select-currency' : ''}`;
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `spend-select-menu-${++sequence}`);
    controls.set(select, button);
    select.classList.add('spend-select-native');
    select.hidden = true;
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.after(button);
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (active?.button === button) close(); else open(select, button);
    });
    button.addEventListener('keydown', event => keydown(event, select, button));
    // A touch can blur the trigger before its option click is delivered.
    // Outside pointer/click, Tab, Escape and visibility handlers own dismissal.
    sync(select);
  }

  function scan() {
    document.querySelectorAll('select').forEach(upgrade);
    if (active && (!active.button.isConnected || !active.select.isConnected)) close();
  }
  window.lexiSpendRefreshSelect = sync;
  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement) sync(event.target);
  });
  document.addEventListener('reset', () => setTimeout(scan, 0));
  document.addEventListener('pointerdown', event => {
    if (active && !active.button.contains(event.target) && !active.menu.contains(event.target)) close();
  }, true);
  document.addEventListener('click', event => {
    if (active && !active.button.contains(event.target) && !active.menu.contains(event.target)) close();
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  new MutationObserver(records => {
    if (active && records.some(record => record.type === 'childList' &&
      (record.target === active.select || active.select.contains(record.target)))) close();
    scan();
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected']});
  scan();
})();
