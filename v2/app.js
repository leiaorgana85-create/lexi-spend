(() => {
  'use strict';

  const CURRENCIES = ['THB','KRW','VND','JPY','MXN','USD'];
  const VIEW_KEY = 'lexiSpendV2ActiveView';
  const CASH_CURRENCY_KEY = 'lexiSpendV2CashCurrency';
  const CALENDAR_CACHE_PREFIX = 'lexiSpendV2Calendar:';
  const APP_STATE_CACHE_KEY = 'lexiSpendV2AppState';
  const $ = id => document.getElementById(id);

  const state = {
    app: null,
    activeView: 'track',
    cashCurrency: '',
    calendarCursor: monthStart(new Date()),
    calendar: new Map(),
    calendarLoads: new Map(),
    calendarVersions: new Map(),
    selectedDate: '',
    busy: false,
    ledgerVersion: 0,
    syncQueued: false,
    autoDates: {},
    manualDates: {},
    localDay: localIsoDate(),
    syncing: false,
    hiddenAt: 0
  };

  function localIsoDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function monthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
  function monthTitle(date) { return date.toLocaleDateString(undefined, { month:'long', year:'numeric' }); }
  function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
  function inclusiveIsoDays(start, end) {
    const a = Date.parse(`${String(start || '')}T00:00:00Z`);
    const b = Date.parse(`${String(end || '')}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }
  function compactDateRange(start, end) {
    const a = new Date(`${String(start || '')}T12:00:00`);
    const b = new Date(`${String(end || '')}T12:00:00`);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return '';
    const sameYear = a.getFullYear() === b.getFullYear();
    const sameMonth = sameYear && a.getMonth() === b.getMonth();
    const left = a.toLocaleDateString(undefined, { month:'short', day:'numeric', ...(sameYear ? {} : { year:'numeric' }) });
    const right = sameMonth
      ? b.toLocaleDateString(undefined, { day:'numeric' })
      : b.toLocaleDateString(undefined, { month:'short', day:'numeric', ...(!sameYear ? { year:'numeric' } : {}) });
    return `${left}–${right}`;
  }
  function remainingIsoDays(start, end, today = localIsoDate()) {
    const total = inclusiveIsoDays(start, end);
    if (!total) return { remaining:0, total:0 };
    if (today <= start) return { remaining:total, total };
    if (today > end) return { remaining:0, total };
    return { remaining:inclusiveIsoDays(today, end), total };
  }
  function localMoney(value, currency) {
    const n = Number(value || 0);
    try { return new Intl.NumberFormat(undefined, { maximumFractionDigits:2 }).format(n) + ` ${currency || ''}`; }
    catch (_) { return `${n.toFixed(2)} ${currency || ''}`; }
  }
  function escapeText(value) { return String(value == null ? '' : value); }
  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `v2-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function setStatus(id, text, isError = false) {
    const el = $(id); if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--danger)' : '';
  }
  function setConnection(text, level = '') {
    const badge = $('connectionBadge');
    badge.textContent = text;
    badge.className = `status-badge${level ? ` ${level}` : ''}`;
  }

  let receiptStatusTimer = null;
  function setReceiptStatus(text, isError = false) {
    const el = $('receiptStatus');
    if (!el) return;
    clearTimeout(receiptStatusTimer);
    el.textContent = text || '';
    el.className = `receipt-toast${isError ? ' error' : ''}`;
    el.hidden = !text;
    if (text) receiptStatusTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 3000);
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function categories() {
    return Array.isArray(state.app?.summary?.categories) ? state.app.summary.categories : [];
  }

  function fillSelect(select, values, selected) {
    if (!select) return;
    select.replaceChildren();
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = values.includes(selected) ? selected : (values[0] || '');
  }

  function configureControls() {
    const defaultCurrency = state.app?.currency || 'THB';
    fillSelect($('expenseCurrency'), CURRENCIES, $('expenseCurrency').value || defaultCurrency);
    fillSelect($('cashCurrency'), CURRENCIES, state.cashCurrency || defaultCurrency);
    const categorySelect = $('category');
    fillSelect(categorySelect, categories().map(item => item.name), categorySelect.value);
  }

  function hasFormDraft(kind) {
    const ids = kind === 'expense'
      ? ['merchant', 'expenseAmount', 'expenseNote']
      : ['cashAmount', 'atmFee', 'bankDebitUsd', 'cashNote'];
    return ids.some(id => String($(id)?.value || '').trim());
  }

  function refreshLocalDates() {
    const today = localIsoDate();
    const changed = today !== state.localDay;
    state.localDay = today;
    ['expense', 'cash'].forEach(kind => {
      const input = $(`${kind}Date`);
      if (!input || state.manualDates[kind] || hasFormDraft(kind)) return;
      if (input.value && input.value !== state.autoDates[kind]) return;
      if (input.value === today) return;
      state.autoDates[kind] = today;
      input.value = today;
      input.dispatchEvent(new Event('change', { bubbles:true }));
    });
    return changed;
  }

  function clearSubmittedFields(values) {
    Object.entries(values).forEach(([id, value]) => {
      if ($(id).value === value) $(id).value = '';
    });
  }

  function beginLedgerWrite() {
    state.busy = true;
    state.ledgerVersion++;
    setLedgerButtons(true);
  }

  function setLedgerButtons(disabled) {
    ['saveExpenseButton', 'saveCashButton'].forEach(id => { $(id).disabled = disabled; });
    document.querySelectorAll('#recentTransactions .deleteCompact, #recentWithdrawals .deleteCompact')
      .forEach(button => { button.disabled = disabled; });
  }

  function finishLedgerWrite() {
    state.ledgerVersion++;
    state.busy = false;
    setLedgerButtons(false);
    refreshLocalDates();
    if (state.syncQueued && !state.syncing) void loadAppState(false);
  }

  function renderRecent() {
    const host = $('recentTransactions');
    host.replaceChildren();
    const rows = Array.isArray(state.app?.recent) ? state.app.recent : [];
    if (!rows.length) {
      host.innerHTML = '<div class="list-empty">No spending.</div>';
      return;
    }

    rows.slice(0, 4).forEach(tx => {
      const row = document.createElement('article');
      row.className = 'txnCompact';

      const main = document.createElement('div');
      main.className = 'txnCompactMain';

      const title = document.createElement('div');
      title.className = 'txnCompactTitle';
      title.textContent = [tx.merchant || 'Expense', tx.category].filter(Boolean).join(' · ');

      const meta = document.createElement('div');
      meta.className = 'txnCompactMeta';
      meta.textContent = [tx.date, tx.paymentMethod].filter(Boolean).join(' · ');
      main.append(title, meta);

      const amount = document.createElement('div');
      amount.className = 'txnCompactAmt';
      const local = `${tx.localAmount ?? ''} ${tx.currency || ''}`.trim();
      amount.append(document.createTextNode(local));
      if (tx.usdAmount) {
        const usd = document.createElement('span');
        usd.className = 'txnCompactUsd';
        usd.textContent = ` (${tx.usdAmount})`;
        amount.appendChild(usd);
      }

      const del = document.createElement('button');
      del.className = 'deleteCompact';
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete transaction');
      del.title = 'Delete';
      del.addEventListener('click', () => deleteExpense(tx));

      row.append(main, amount, del);
      host.appendChild(row);
    });
  }

  function renderBudget() {
    const summary = state.app?.summary;
    if (!summary) return;

    const periodDays = Math.max(1, Number(summary.periodDays) || 1);
    const weekDays = Math.max(1, inclusiveIsoDays(summary.weekStart, summary.weekEnd) || Math.min(7, periodDays));
    const weeklyBudget = Number(summary.budgetLimit || 0) * (weekDays / periodDays);
    const weekRatio = weeklyBudget > 0 ? Number(summary.weeklyTotal || 0) / weeklyBudget : 0;
    const periodRatio = Number(summary.budgetLimit) > 0 ? Number(summary.budgetTotal) / Number(summary.budgetLimit) : 0;
    const weekRemaining = remainingIsoDays(summary.weekStart, summary.weekEnd);
    const periodRemaining = remainingIsoDays(summary.periodStart, summary.periodEnd);

    setText('budgetWeekDates', compactDateRange(summary.weekStart, summary.weekEnd));
    setText('budgetWeekDays', `${weekRemaining.remaining} of ${weekRemaining.total} days remaining`);
    setText('budgetPeriodDates', compactDateRange(summary.periodStart, summary.periodEnd));
    setText('budgetPeriodDays', `${periodRemaining.remaining} of ${periodRemaining.total} days remaining`);
    setText('budgetTotalValue', money(summary.budgetTotal));
    setText('budgetTotalSub', money(summary.budgetLimit));
    setText('weeklySpend', money(summary.weeklyTotal));
    setText('weeklyBudget', money(weeklyBudget));
    setText('allTrackedSpend', money(summary.stayTotal));

    const weeklyBar = $('budgetWeeklyProgress');
    weeklyBar.style.width = `${Math.min(100, Math.max(0, weekRatio * 100))}%`;
    weeklyBar.className = `progress-fill${weekRatio > 1 ? ' over' : weekRatio >= .8 ? ' near' : ''}`;

    const periodBar = $('budgetOverallProgress');
    periodBar.style.width = `${Math.min(100, Math.max(0, periodRatio * 100))}%`;
    periodBar.className = `progress-fill${periodRatio > 1 ? ' over' : periodRatio >= .8 ? ' near' : ''}`;

    const host = $('categoryBudgetList');
    host.replaceChildren();
    (summary.categories || []).forEach(category => {
      const row = document.createElement('div');
      row.className = 'budget-row';
      const head = document.createElement('div');
      head.className = 'budget-row-head';
      const label = document.createElement('span');
      label.textContent = category.name;
      const value = document.createElement('strong');
      value.textContent = category.limit == null ? `${money(category.spent)} · no limit` : `${money(category.spent)} / ${money(category.limit)}`;
      head.append(label, value);
      row.appendChild(head);
      if (category.limit != null) {
        const track = document.createElement('div');
        track.className = 'progress-track';
        const fill = document.createElement('div');
        const r = Number(category.limit) > 0 ? Number(category.spent) / Number(category.limit) : 0;
        fill.className = `progress-fill${r > 1 ? ' over' : r >= .8 ? ' near' : ''}`;
        fill.style.width = `${Math.min(100, Math.max(0, r * 100))}%`;
        track.appendChild(fill);
        row.appendChild(track);
      }
      host.appendChild(row);
    });
  }

  function currentCash() {
    const wallets = state.app?.cashWallets || {};
    return wallets[state.cashCurrency] || state.app?.cash || null;
  }

  function currentCalendarMonthAtmFeesUsd() {
    return Object.values(state.app?.cashWallets || {}).reduce(
      (total, wallet) => total + Number(wallet?.calendarMonthFeesUsd || 0),
      0
    );
  }

  function renderCash() {
    const cash = currentCash();
    if (!cash) return;
    const currentMonthName = new Date().toLocaleDateString(undefined, { month:'long' });
    setText('cashBalance', localMoney(cash.balance, cash.currency));
    setText('cashFees', money(currentCalendarMonthAtmFeesUsd()));
    const cashFeesLabel = $('cashFees')?.previousElementSibling;
    if (cashFeesLabel) cashFeesLabel.textContent = `ATM fees · ${currentMonthName}`;
    setText('cashWithdrawn', localMoney(cash.withdrawals, cash.currency));
    setText('cashSpent', localMoney(cash.cashSpent, cash.currency));
    setText('withdrawalsTitle', `Withdrawals · ${currentMonthName}`);

    const host = $('recentWithdrawals');
    host.replaceChildren();
    const rows = Array.isArray(cash.monthWithdrawals)
      ? cash.monthWithdrawals.slice().sort((a,b) => String(b?.date || '').localeCompare(String(a?.date || '')))
      : [];
    if (!rows.length) {
      host.innerHTML = `<div class="list-empty">No ${currentMonthName} withdrawals.</div>`;
      return;
    }
    rows.forEach(w => {
      const row = document.createElement('article');
      row.className = 'txnCompact';

      const main = document.createElement('div');
      main.className = 'txnCompactMain';
      const title = document.createElement('div');
      title.className = 'txnCompactTitle';
      title.textContent = w.date || 'Withdrawal';
      const meta = document.createElement('div');
      meta.className = 'txnCompactMeta';
      meta.textContent = [
        Number(w.atmFeeUsd || 0) ? `fee ${money(w.atmFeeUsd)}` : '',
        Number(w.bankDebitUsd || 0) ? `bank ${money(w.bankDebitUsd)}` : '',
        w.note || ''
      ].filter(Boolean).join(' · ');
      main.append(title);
      if (meta.textContent) main.append(meta);

      const amount = document.createElement('div');
      amount.className = 'txnCompactAmt';
      amount.append(document.createTextNode(localMoney(w.amount, w.currency)));
      const usd = document.createElement('span');
      usd.className = 'txnCompactUsd';
      usd.textContent = ` (${money(w.usdEquivalent)})`;
      amount.appendChild(usd);

      const del = document.createElement('button');
      del.className = 'deleteCompact';
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete cash withdrawal');
      del.title = 'Delete';
      del.addEventListener('click', () => deleteCash(w));

      row.append(main, amount, del);
      host.appendChild(row);
    });
  }

  function renderApp({ persist = false } = {}) {
    if (!state.app) return;
    configureControls();
    renderRecent();
    renderBudget();
    renderCash();
    setLedgerButtons(state.busy);
    setText('settingsBackendVersion', state.app.appVersion || '—');
    setText('settingsFrontendVersion', 'v2.0.4');
    if (persist) saveJson(APP_STATE_CACHE_KEY, { savedAt:Date.now(), app:state.app });
  }

  function setConnected() {
    setText('settingsConnection', 'Connected');
    setConnection('Connected', 'ok');
  }

  function restoreCachedAppState() {
    const cached = readJson(APP_STATE_CACHE_KEY);
    if (!cached?.app) return false;
    state.app = cached.app;
    state.cashCurrency = readCashCurrency() || state.app.currency || 'THB';
    renderApp();
    setText('settingsConnection', 'Syncing');
    setConnection('Syncing');
    return true;
  }

  function readCashCurrency() {
    try { return String(localStorage.getItem(CASH_CURRENCY_KEY) || '').trim(); } catch (_) { return ''; }
  }
  function saveCashCurrency(value) {
    state.cashCurrency = value;
    try { localStorage.setItem(CASH_CURRENCY_KEY, value); } catch (_) {}
  }

  async function loadAppState(showError = true) {
    if (state.busy) { state.syncQueued = true; return false; }
    if (state.syncing) return false;
    state.syncQueued = false;
    state.syncing = true;
    setConnection(state.app ? 'Syncing' : 'Connecting');
    setText('settingsConnection', state.app ? 'Syncing' : 'Connecting');

    let lastError = null;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const requestVersion = state.ledgerVersion;
          const requestDay = localIsoDate();
          const result = await SpendApi.call(
            'getAppState',
            [requestDay, state.cashCurrency || ''],
            { timeoutMs:20000 }
          );
          if (requestVersion !== state.ledgerVersion || state.busy || requestDay !== localIsoDate()) {
            state.syncQueued = true;
            return false;
          }
          state.app = result;
          if (!state.cashCurrency) state.cashCurrency = readCashCurrency() || result.currency || 'THB';
          renderApp({ persist:true });
          setConnected();
          return true;
        } catch (error) {
          if (state.busy) { state.syncQueued = true; return false; }
          if (String(error?.message) === 'NOT_CONNECTED') {
            setConnection('Not connected', 'error');
            setText('settingsConnection', 'Not connected');
            openConnectDialog();
            return false;
          }
          lastError = error;
          if (attempt === 0) {
            SpendApi.resetBridge();
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }
      }

      setConnection('Sync error', 'error');
      setText('settingsConnection', 'Sync error');
      if (showError) setStatus('expenseStatus', lastError?.message || 'Could not load.', true);
      return false;
    } finally {
      state.syncing = false;
      if (state.syncQueued && !state.busy) void loadAppState(false);
    }
  }

  function showView(view, loadCalendar = true) {
    if (!['track','budget','cash','calendar'].includes(view)) view = 'track';
    state.activeView = view;
    document.body.dataset.activeView = view;
    document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === view));
    document.querySelectorAll('.lexi-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    if (loadCalendar && view === 'calendar') loadCalendarMonth(monthKey(state.calendarCursor));
  }

  function readView() {
    try { return localStorage.getItem(VIEW_KEY) || 'track'; } catch (_) { return 'track'; }
  }

  let converterTimer = null;
  function scheduleConverter() {
    clearTimeout(converterTimer);
    converterTimer = setTimeout(updateConverter, 280);
  }
  async function updateConverter() {
    const amount = Number($('converterAmount').value || 0);
    if (!Number.isFinite(amount) || amount < 0) return;
    setStatus('converterStatus', amount ? '…' : '');
    if (!amount) { setText('converterUsd', '$0.00'); setStatus('converterStatus', ''); return; }
    try {
      const r = await SpendApi.call('previewUsd', [amount, $('expenseCurrency').value, localIsoDate()]);
      setText('converterUsd', money(r.usdAmount));
      setStatus('converterStatus', r.effectiveDate || '');
    } catch (error) { setStatus('converterStatus', 'Unavailable', true); }
  }

  let previewTimer = null;
  function scheduleExpensePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updateExpensePreview, 300);
  }
  async function updateExpensePreview() {
    const amount = Number($('expenseAmount').value || 0);
    if (!amount || amount < 0) { setText('expenseUsdPreview', ''); return; }
    try {
      const r = await SpendApi.call('previewUsd', [amount, $('expenseCurrency').value, $('expenseDate').value]);
      setText('expenseUsdPreview', money(r.usdAmount));
    } catch (_) { setText('expenseUsdPreview', '—'); }
  }

  let cashPreviewTimer = null;
  function scheduleCashPreview() {
    clearTimeout(cashPreviewTimer);
    cashPreviewTimer = setTimeout(updateCashPreview, 300);
  }
  async function updateCashPreview() {
    const amount = Number($('cashAmount').value || 0);
    const fee = Number($('atmFee').value || 0);
    if (!amount || amount < 0 || fee < 0) { setText('cashUsdPreview', ''); return; }
    try {
      const r = await SpendApi.call('previewUsd', [amount, $('cashCurrency').value, $('cashDate').value]);
      const feeUsd = Number(fee || 0) * Number(r.rate || 0);
      setText('cashUsdPreview', fee > 0 ? `≈ ${money(r.usdAmount)} · fee ${money(feeUsd)}` : `≈ ${money(r.usdAmount)}`);
    } catch (_) { setText('cashUsdPreview', '—'); }
  }

  async function receiptDataUrl(file) {
    if (!file) return '';
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Receipt must be JPEG, PNG, or WebP.');

    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not read receipt image.'));
        img.src = sourceUrl;
      });
      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha:false });
      if (!ctx) throw new Error('Could not prepare receipt image.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', .82);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  async function uploadStandaloneReceipt() {
    const input = $('receiptInput');
    const file = input?.files?.[0] || null;
    if (!file) return;
    const receiptId = uuid();
    try {
      $('receiptButton').disabled = true;
      setReceiptStatus('Preparing receipt…');
      const dataUrl = await receiptDataUrl(file);
      setReceiptStatus('Saving receipt to Drive…');
      await retryWrite('uploadReceipt', [{
        entryId: receiptId,
        dataUrl,
        date: localIsoDate(),
        label: 'receipt'
      }]);
      setReceiptStatus('Receipt saved to Drive');
    } catch (error) {
      setReceiptStatus(error?.message || 'Could not save receipt.', true);
    } finally {
      input.value = '';
      $('receiptButton').disabled = false;
    }
  }

  async function retryWrite(name, params) {
    try { return await SpendApi.call(name, params); }
    catch (first) {
      const message = String(first?.message || first || '');
      if (!/timed out|network|connect/i.test(message)) throw first;
      return await SpendApi.call(name, params);
    }
  }

  async function saveExpense(event) {
    event.preventDefault();
    if (state.busy) return;
    const amount = Number($('expenseAmount').value);
    if (!Number.isFinite(amount) || amount < 0) { setStatus('expenseStatus', 'Enter a valid amount.', true); return; }
    if (!$('merchant').value.trim()) { setStatus('expenseStatus', 'Merchant is required.', true); return; }
    beginLedgerWrite();
    setStatus('expenseStatus', 'Saving…');
    const entryId = uuid();
    const submitted = { merchant:$('merchant').value, expenseAmount:$('expenseAmount').value, expenseNote:$('expenseNote').value };
    const payload = {
      entryId,
      date:$('expenseDate').value,
      merchant:$('merchant').value.trim(),
      category:$('category').value,
      paymentMethod:$('paymentMethod').value,
      amount,
      currency:$('expenseCurrency').value,
      country:state.app?.country || '',
      note:$('expenseNote').value.trim(),
      today:localIsoDate()
    };
    try {
      const result = await retryWrite('logExpense', [payload]);

      const calendarExpense = {
        entryId:result.entryId || entryId,
        date:payload.date,
        merchant:payload.merchant,
        category:payload.category,
        paymentMethod:payload.paymentMethod,
        localAmount:amount,
        currency:payload.currency,
        usdAmount:Number(result.usdAmount || 0),
        country:payload.country,
        note:payload.note,
        receiptUrl:''
      };
      state.app = { ...state.app, recent:result.recent, summary:result.summary };
      if (result.cash && state.app?.cashWallets) state.app.cashWallets[result.cash.currency] = result.cash;
      renderApp({ persist:true });
      if (!applyCalendarExpenseSave(calendarExpense)) refreshCalendarMonthInBackgroundForDate(calendarExpense.date);
      clearSubmittedFields(submitted);
      setText('expenseUsdPreview', '');
      setStatus('expenseStatus', result.deduped ? 'Saved · confirmed retry' : 'Saved');
    } catch (error) {
      setStatus('expenseStatus', error?.message || 'Could not save expense.', true);
    } finally {
      finishLedgerWrite();
    }
  }

  async function deleteExpense(tx) {
    if (state.busy) return;
    if (!confirm(`Delete ${tx.merchant || 'this expense'} ${tx.usdAmount || ''}?`)) return;
    beginLedgerWrite();
    setStatus('expenseStatus', 'Deleting…');
    try {
      const result = await retryWrite('deleteExpense', [tx.entryId, localIsoDate(), {
        name:state.app?.stayName || '', start:state.app?.stayStart || '', end:state.app?.stayEnd || '', status:state.app?.stayStatus || ''
      }]);
      state.app = { ...state.app, recent:result.recent, summary:result.summary };
      const deletedCash = String(result.deleted?.paymentMethod || tx.paymentMethod || '') === 'Cash';
      if (deletedCash && (result.alreadyDeleted || !applyCashSpendDeletion(result.deleted))) {
        state.syncQueued = true;
      } else {
        renderApp({ persist:true });
      }
      if (!applyCalendarExpenseDelete(tx)) refreshCalendarMonthInBackgroundForDate(tx.date);
      setStatus('expenseStatus', 'Deleted');
    } catch (error) { setStatus('expenseStatus', error?.message || 'Could not delete.', true); }
    finally { finishLedgerWrite(); }
  }

  function applyCashSpendDeletion(expense) {
    if (!expense || !state.app || String(expense.paymentMethod || '') !== 'Cash') return false;
    const currency = String(expense.currency || '').toUpperCase();
    const amount = Number(expense.amount || 0);
    const current = state.app.cashWallets?.[currency];
    if (!currency || !Number.isFinite(amount) || amount < 0 || !current) return false;

    const next = { ...current };
    next.cashSpent = Math.max(0, Number(current.cashSpent || 0) - amount);
    next.balance = Number(next.withdrawals || 0) - next.cashSpent;
    state.app.cashWallets[currency] = next;
    if (state.app.cash?.currency === currency) state.app.cash = next;
    return true;
  }

  function applyCashWithdrawalDelta(withdrawal, direction) {
    if (!withdrawal || !state.app) return;
    const currency = String(withdrawal.currency || '').toUpperCase();
    if (!currency) return;
    if (!state.app.cashWallets) state.app.cashWallets = {};
    const current = state.app.cashWallets[currency] || {
      currency, withdrawals:0, cashSpent:0, balance:0, calendarMonthFees:0, calendarMonthFeesUsd:0, recentWithdrawals:[], monthWithdrawals:[]
    };
    const sign = direction >= 0 ? 1 : -1;
    const next = { ...current };
    next.withdrawals = Math.max(0, Number(current.withdrawals || 0) + sign * Number(withdrawal.amount || 0));
    next.balance = Number(current.balance || 0) + sign * Number(withdrawal.amount || 0);
    const isCurrentMonth = String(withdrawal.date || '').slice(0,7) === localIsoDate().slice(0,7);
    const recent = Array.isArray(current.recentWithdrawals) ? current.recentWithdrawals.slice() : [];
    const monthRows = Array.isArray(current.monthWithdrawals) ? current.monthWithdrawals.slice() : [];
    let updatedMonthRows = monthRows;
    if (sign > 0 && isCurrentMonth) {
      next.calendarMonthFees = Math.max(0, Number(current.calendarMonthFees || 0) + Number(withdrawal.atmFee || 0));
      next.calendarMonthFeesUsd = Math.max(0, Number(current.calendarMonthFeesUsd || 0) + Number(withdrawal.atmFeeUsd || 0));
      next.recentWithdrawals = [withdrawal, ...recent.filter(x => x.entryId !== withdrawal.entryId)];
      updatedMonthRows = [withdrawal, ...monthRows.filter(x => x.entryId !== withdrawal.entryId)]
        .sort((a,b) => String(b?.date || '').localeCompare(String(a?.date || '')));
    } else if (sign < 0) {
      if (isCurrentMonth) {
        next.calendarMonthFees = Math.max(0, Number(current.calendarMonthFees || 0) - Number(withdrawal.atmFee || 0));
        next.calendarMonthFeesUsd = Math.max(0, Number(current.calendarMonthFeesUsd || 0) - Number(withdrawal.atmFeeUsd || 0));
        updatedMonthRows = monthRows.filter(x => x.entryId !== withdrawal.entryId);
      }
      next.recentWithdrawals = recent.filter(x => x.entryId !== withdrawal.entryId);
    }
    if (isCurrentMonth) next.monthWithdrawals = updatedMonthRows;
    state.app.cashWallets[currency] = next;
    if (isCurrentMonth) {
      Object.keys(state.app.cashWallets).forEach(code => {
        state.app.cashWallets[code] = { ...state.app.cashWallets[code], monthWithdrawals:updatedMonthRows.slice() };
      });
    }
    if (state.app.cash?.currency === currency) state.app.cash = state.app.cashWallets[currency];
    saveJson(APP_STATE_CACHE_KEY, { savedAt:Date.now(), app:state.app });
    renderCash();
  }

  async function saveCash(event) {
    event.preventDefault();
    if (state.busy) return;
    const amount = Number($('cashAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) { setStatus('cashStatus', 'Enter an amount greater than zero.', true); return; }
    beginLedgerWrite();
    setStatus('cashStatus', 'Saving…');
    const entryId = uuid();
    const submitted = Object.fromEntries(['cashAmount','atmFee','bankDebitUsd','cashNote'].map(id => [id, $(id).value]));
    try {
      const result = await retryWrite('addCashWithdrawal', [{
        entryId,
        date:$('cashDate').value,
        amount,
        atmFee:Number($('atmFee').value || 0),
        bankDebitUsd:$('bankDebitUsd').value.trim(),
        currency:$('cashCurrency').value,
        country:state.app?.country || '',
        note:$('cashNote').value.trim()
      }]);
      applyCashWithdrawalDelta(result.withdrawal, 1);
      clearSubmittedFields(submitted);
      setText('cashUsdPreview', '');
      setStatus('cashStatus', result.deduped ? 'Saved · confirmed retry' : 'Saved');
    } catch (error) { setStatus('cashStatus', error?.message || 'Could not save withdrawal.', true); }
    finally { finishLedgerWrite(); }
  }

  async function deleteCash(withdrawal) {
    if (state.busy) return;
    if (!confirm(`Delete ${localMoney(withdrawal.amount, withdrawal.currency)} withdrawal?`)) return;
    beginLedgerWrite();
    setStatus('cashStatus', 'Deleting…');
    try {
      const result = await retryWrite('deleteCashWithdrawal', [withdrawal.entryId]);
      if (result.alreadyDeleted) state.syncQueued = true;
      else applyCashWithdrawalDelta(result.deleted || withdrawal, -1);
      setStatus('cashStatus', 'Deleted');
    } catch (error) { setStatus('cashStatus', error?.message || 'Could not delete.', true); }
    finally { finishLedgerWrite(); }
  }

  function calendarCacheKey(month) { return `${CALENDAR_CACHE_PREFIX}${month}`; }
  function restoreCalendarCache(month) {
    const cached = readJson(calendarCacheKey(month));
    if (!cached?.data) return null;
    state.calendar.set(month, cached.data);
    return cached.data;
  }
  function saveCalendarCache(month, data, confirmedRead = true) {
    state.calendar.set(month, data);
    const savedAt = confirmedRead ? Date.now() : Number(readJson(calendarCacheKey(month))?.savedAt || 0);
    saveJson(calendarCacheKey(month), { savedAt, data });
  }
  function calendarCachedMonth(month) {
    return state.calendar.get(month) || restoreCalendarCache(month);
  }
  function calendarVersion(month) {
    return Number(state.calendarVersions.get(month) || 0);
  }
  function markCalendarMutation(month) {
    state.calendarVersions.set(month, calendarVersion(month) + 1);
  }
  function roundCalendarMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }
  function recomputeCalendarDay(day) {
    const transactions = Array.isArray(day?.transactions) ? day.transactions : [];
    const categories = {};
    let totalUsd = 0;
    transactions.forEach(tx => {
      const usdAmount = Number(tx?.usdAmount || 0);
      const category = String(tx?.category || '').trim() || 'Other';
      totalUsd += usdAmount;
      categories[category] = roundCalendarMoney((categories[category] || 0) + usdAmount);
    });
    day.transactions = transactions;
    day.totalUsd = roundCalendarMoney(totalUsd);
    day.count = transactions.length;
    day.categories = categories;
  }
  function recomputeCalendarMonth(data) {
    if (!data || typeof data !== 'object') return data;
    if (!data.days || typeof data.days !== 'object') data.days = {};
    let monthTotalUsd = 0;
    let transactionCount = 0;
    Object.keys(data.days).forEach(date => {
      const day = data.days[date];
      recomputeCalendarDay(day);
      if (!day.count) {
        delete data.days[date];
        return;
      }
      monthTotalUsd += Number(day.totalUsd || 0);
      transactionCount += Number(day.count || 0);
    });
    data.monthTotalUsd = roundCalendarMoney(monthTotalUsd);
    data.transactionCount = transactionCount;
    return data;
  }
  function commitCalendarMutation(month, data) {
    recomputeCalendarMonth(data);
    saveCalendarCache(month, data, false);
    if (state.activeView === 'calendar' && month === monthKey(state.calendarCursor)) renderCalendar(data);
  }
  function applyCalendarExpenseSave(expense) {
    const date = String(expense?.date || '');
    const month = date.slice(0,7);
    if (!month) return false;
    const category = String(expense?.category || '').trim();
    if (category === 'Housing' || category === 'Travel & Irregular') return true;
    markCalendarMutation(month);
    const data = calendarCachedMonth(month);
    if (!data) return false;
    if (!data.days || typeof data.days !== 'object') data.days = {};
    const day = data.days[date] || { totalUsd:0, count:0, categories:{}, transactions:[] };
    const entryId = String(expense?.entryId || '');
    day.transactions = (Array.isArray(day.transactions) ? day.transactions : [])
      .filter(tx => !entryId || String(tx?.entryId || '') !== entryId);
    day.transactions.push({
      entryId,
      date,
      merchant:String(expense?.merchant || ''),
      category,
      paymentMethod:String(expense?.paymentMethod || ''),
      localAmount:Number(expense?.localAmount || 0),
      currency:String(expense?.currency || ''),
      usdAmount:roundCalendarMoney(expense?.usdAmount),
      country:String(expense?.country || ''),
      note:String(expense?.note || ''),
      receiptUrl:String(expense?.receiptUrl || '')
    });
    data.days[date] = day;
    commitCalendarMutation(month, data);
    return true;
  }
  function applyCalendarExpenseDelete(expense) {
    const date = String(expense?.date || '');
    const month = date.slice(0,7);
    if (!month) return false;
    const category = String(expense?.category || '').trim();
    if (category === 'Housing' || category === 'Travel & Irregular') return true;
    markCalendarMutation(month);
    const data = calendarCachedMonth(month);
    if (!data) return false;
    const entryId = String(expense?.entryId || '');
    if (entryId && data.days && typeof data.days === 'object') {
      Object.keys(data.days).forEach(dayDate => {
        const day = data.days[dayDate];
        if (!Array.isArray(day?.transactions)) return;
        day.transactions = day.transactions.filter(tx => String(tx?.entryId || '') !== entryId);
      });
    }
    commitCalendarMutation(month, data);
    return true;
  }
  function refreshCalendarMonthInBackgroundForDate(date) {
    const month = String(date || '').slice(0,7);
    if (!month || month !== monthKey(state.calendarCursor)) return;
    void loadCalendarMonth(month, true);
  }

  function renderCalendar(data) {
    setText('calendarMonthTitle', monthTitle(state.calendarCursor));
    const host = $('calendarGrid');
    host.replaceChildren();
    const month = monthKey(state.calendarCursor);
    const totals = data?.days || {};
    const first = monthStart(state.calendarCursor);
    const mondayIndex = (first.getDay() + 6) % 7;
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - mondayIndex);
    const today = localIsoDate();

    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const iso = localIsoDate(date);
      const day = totals[iso];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `calendar-day${iso.slice(0,7) !== month ? ' outside' : ''}${iso === state.selectedDate ? ' selected' : ''}${iso === today ? ' today' : ''}`;
      button.dataset.date = iso;
      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(date.getDate());
      button.appendChild(number);
      if (day && Number(day.totalUsd) > 0) {
        const spend = document.createElement('span');
        spend.className = 'day-spend';
        spend.textContent = money(day.totalUsd);
        const count = document.createElement('span');
        count.className = 'day-count';
        count.textContent = `${day.count || 0} item${Number(day.count) === 1 ? '' : 's'}`;
        button.append(spend, count);
      }
      button.addEventListener('click', () => {
        if (iso.slice(0,7) !== month) {
          state.calendarCursor = monthStart(date);
          state.selectedDate = iso;
          loadCalendarMonth(monthKey(state.calendarCursor));
          return;
        }
        state.selectedDate = iso;
        renderCalendar(data);
        renderDayDetails(data, iso);
      });
      host.appendChild(button);
    }

    if (!state.selectedDate || state.selectedDate.slice(0,7) !== month) {
      state.selectedDate = today.slice(0,7) === month ? today : `${month}-01`;
    }
    host.querySelector(`[data-date="${state.selectedDate}"]`)?.classList.add('selected');
    renderDayDetails(data, state.selectedDate);
  }

  function renderDayDetails(data, date) {
    setText('selectedDayTitle', new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' }));
    const day = data?.days?.[date] || { totalUsd:0, categories:{}, transactions:[] };
    setText('selectedDayTotal', money(day.totalUsd));
    const chips = $('selectedDayCategories');
    chips.replaceChildren();
    Object.entries(day.categories || {}).sort((a,b) => b[1] - a[1]).forEach(([name,value]) => {
      const chip = document.createElement('span');
      chip.className = 'category-chip';
      chip.textContent = `${name} ${money(value)}`;
      chips.appendChild(chip);
    });
    const list = $('selectedDayTransactions');
    list.replaceChildren();
    const rows = day.transactions || [];
    if (!rows.length) {
      list.innerHTML = '<div class="list-empty">No spend.</div>';
      return;
    }
    rows.forEach(tx => {
      const item = document.createElement('article');
      item.className = 'calendar-txn-row';

      const main = document.createElement('div');
      main.className = 'calendar-txn-main';
      main.textContent = [tx.merchant || 'Expense', tx.category, tx.paymentMethod].filter(Boolean).join(' · ');

      const amount = document.createElement('div');
      amount.className = 'calendar-txn-amount';
      amount.append(document.createTextNode(localMoney(tx.localAmount, tx.currency)));
      const usd = document.createElement('span');
      usd.className = 'calendar-txn-usd';
      usd.textContent = ` (${money(tx.usdAmount)})`;
      amount.appendChild(usd);

      item.append(main, amount);
      list.appendChild(item);
    });
  }

  async function loadCalendarMonth(month, force = false) {
    const isCurrentMonth = () => month === monthKey(state.calendarCursor);
    if (isCurrentMonth()) setText('calendarMonthTitle', monthTitle(state.calendarCursor));
    if (!force) {
      const memory = calendarCachedMonth(month);
      if (memory && isCurrentMonth()) renderCalendar(memory);
    }
    if (isCurrentMonth() && state.activeView === 'calendar') setStatus('calendarStatus', 'Syncing…');

    const existing = state.calendarLoads.get(month);
    if (existing) return existing;

    const requestVersion = calendarVersion(month);
    let refreshAfterMutation = false;
    const request = (async () => {
      try {
        const data = await SpendApi.call('getCalendarMonth', [month]);
        if (calendarVersion(month) !== requestVersion) {
          const cached = calendarCachedMonth(month);
          if (isCurrentMonth() && cached) renderCalendar(cached);
          refreshAfterMutation = true;
          return cached || null;
        }
        saveCalendarCache(month, data);
        if (isCurrentMonth()) {
          renderCalendar(data);
          setStatus('calendarStatus', '');
        }
        return data;
      } catch (error) {
        const cached = calendarCachedMonth(month);
        if (isCurrentMonth()) {
          if (cached) renderCalendar(cached);
          setStatus('calendarStatus', cached ? 'Could not refresh · showing saved data' : (error?.message || 'Could not load month'), !cached);
        }
        return cached || null;
      } finally {
        state.calendarLoads.delete(month);
        if (refreshAfterMutation) void loadCalendarMonth(month, true);
      }
    })();

    state.calendarLoads.set(month, request);
    return request;
  }

  function openConnectDialog() {
    const dialog = $('connectDialog');
    if (!dialog.open) dialog.showModal();
    setTimeout(() => $('apiCodeInput').focus(), 0);
  }

  async function connect(event) {
    event.preventDefault();
    const code = $('apiCodeInput').value.trim();
    if (!code) return;
    $('connectButton').disabled = true;
    setStatus('connectStatus', 'Connecting…');
    try {
      const result = await SpendApi.connect(code, localIsoDate());
      state.app = result;
      state.cashCurrency = readCashCurrency() || result.currency || 'THB';
      renderApp({ persist:true });
      setConnected();
      $('apiCodeInput').value = '';
      $('connectDialog').close();
      setStatus('connectStatus', '');
      showView(state.activeView);
      if (state.activeView !== 'calendar') void loadCalendarMonth(monthKey(state.calendarCursor));
    } catch (error) { setStatus('connectStatus', error?.message || 'Could not connect.', true); }
    finally { $('connectButton').disabled = false; }
  }

  function bind() {
    document.querySelectorAll('.lexi-tab').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.view)));
    $('receiptButton')?.addEventListener('click', () => $('receiptInput')?.click());
    $('receiptInput')?.addEventListener('change', uploadStandaloneReceipt);
    $('settingsButton').addEventListener('click', () => $('settingsDialog').showModal());
    $('closeSettingsButton').addEventListener('click', () => $('settingsDialog').close());
    $('reconnectButton').addEventListener('click', () => { $('settingsDialog').close(); openConnectDialog(); });
    $('forgetApiCodeButton').addEventListener('click', async () => {
      if (!confirm('Forget the saved API code on this device?')) return;
      await SpendApi.clearCode();
      setText('settingsConnection', 'Not connected');
      $('settingsDialog').close();
      openConnectDialog();
    });
    $('connectForm').addEventListener('submit', connect);
    ['expense', 'cash'].forEach(kind => {
      $(`${kind}Date`).addEventListener('change', () => {
        state.manualDates[kind] = $(`${kind}Date`).value !== state.autoDates[kind];
      });
      $(`${kind}Form`).addEventListener('focusin', refreshLocalDates);
    });
    $('expenseForm').addEventListener('submit', saveExpense);
    $('cashForm').addEventListener('submit', saveCash);
    $('converterAmount').addEventListener('input', scheduleConverter);
    ['expenseAmount','expenseCurrency','expenseDate'].forEach(id => $(id).addEventListener(id === 'expenseAmount' ? 'input' : 'change', scheduleExpensePreview));
    $('expenseCurrency').addEventListener('change', scheduleConverter);
    ['cashAmount','atmFee','cashDate'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener(['cashAmount','atmFee'].includes(id) ? 'input' : 'change', scheduleCashPreview);
    });
    $('cashCurrency').addEventListener('change', () => {
      saveCashCurrency($('cashCurrency').value);
      renderCash();
      scheduleCashPreview();
    });
    $('refreshCashButton')?.addEventListener('click', () => loadAppState());
    $('calendarPrevButton').addEventListener('click', () => {
      state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() - 1, 1);
      state.selectedDate = '';
      loadCalendarMonth(monthKey(state.calendarCursor));
    });
    $('calendarNextButton').addEventListener('click', () => {
      state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + 1, 1);
      state.selectedDate = '';
      loadCalendarMonth(monthKey(state.calendarCursor));
    });
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'hidden') {
        state.hiddenAt = Date.now();
        return;
      }
      const awayMs = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
      state.hiddenAt = 0;
      const dayChanged = refreshLocalDates();
      if ((!dayChanged && awayMs < 30000) || state.syncing) return;
      if (state.busy) { state.syncQueued = true; return; }
      if (!(await SpendApi.hasCode()) || state.syncing) return;
      if (state.busy) { state.syncQueued = true; return; }
      SpendApi.resetBridge();
      const refreshed = await loadAppState(false);
      if (refreshed) void loadCalendarMonth(monthKey(state.calendarCursor), true);
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && refreshLocalDates()) void loadAppState(false);
    }, 60000);
  }

  async function init() {
    bind();
    const today = localIsoDate();
    $('expenseDate').value = today;
    $('cashDate').value = today;
    state.autoDates = { expense:today, cash:today };
    state.activeView = readView();
    state.cashCurrency = readCashCurrency();
    restoreCachedAppState();
    showView(state.activeView, false);
    if (await SpendApi.hasCode()) {
      const refreshed = await loadAppState(false);
      if (refreshed) void loadCalendarMonth(monthKey(state.calendarCursor));
    } else {
      setConnection('Not connected', 'error');
      openConnectDialog();
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { scope:'./' }).catch(() => {});
    }
  }

  init();
})();
