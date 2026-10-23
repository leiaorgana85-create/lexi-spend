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
