(() => {
  'use strict';

  const VERSION = 'v1.09';
  const APP_STATE_CACHE_KEY = 'lexiSpendV2AppState';

  function applyVersion() {
    if (document.documentElement?.dataset?.appVersion !== VERSION) {
      document.documentElement.dataset.appVersion = VERSION;
    }

    const host = document.getElementById('appVersion');
    if (host?.dataset?.version !== VERSION) host.dataset.version = VERSION;

    const label = document.getElementById('settingsFrontendVersion');
    if (label && label.textContent !== VERSION) label.textContent = VERSION;
  }

  function bindBudgetRefresh() {
    const budgetTab = document.querySelector('.lexi-tab[data-view="budget"]');
    if (!budgetTab || budgetTab.dataset.v108BudgetRefresh === '1') return;
    budgetTab.dataset.v108BudgetRefresh = '1';
    budgetTab.addEventListener('click', () => {
      setTimeout(() => document.getElementById('refreshAppButton')?.click(), 0);
    });
  }

  function installCashUiStyles() {
    if (document.getElementById('v109CashUiStyles')) return;
    const style = document.createElement('style');
    style.id = 'v109CashUiStyles';
    style.textContent = `
      #cashScreen .cash-overview { gap:5px; padding:7px 8px; }
      #cashScreen .cash-quick-metrics > div {
        padding:3px 6px;
        flex-direction:row;
        align-items:baseline;
        justify-content:space-between;
        gap:4px;
      }
      #cashScreen .cash-quick-metrics span { font-size:8.5px; line-height:1; white-space:nowrap; }
      #cashScreen .cash-quick-metrics strong { font-size:10.5px; line-height:1; white-space:nowrap; }
    `;
    document.head?.appendChild(style);
  }

  function readCachedApp() {
    try {
      const cached = JSON.parse(localStorage.getItem(APP_STATE_CACHE_KEY) || 'null');
      return cached?.app || null;
    } catch (_) {
      return null;
    }
  }

  function localAmount(value, currency) {
    const number = Number(value || 0);
    let formatted;
    try {
      formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits:2 }).format(number);
    } catch (_) {
      formatted = String(number);
    }
    return `${formatted} ${String(currency || '').trim()}`.trim();
  }

  function withdrawalDetail(withdrawal) {
    const currency = String(withdrawal?.currency || '').trim();
    let primary = localAmount(withdrawal?.amount, currency);
    const fee = Number(withdrawal?.atmFee || 0);
    const bankDebit = Number(withdrawal?.bankDebitUsd || 0);
    if (fee > 0) primary += ` + ${localAmount(fee, currency)} Fee`;
    return bankDebit > 0
      ? `${primary}; Actual Visa Debit Amount $${bankDebit.toFixed(2)}`
      : primary;
  }

  function currentCashWallet(app) {
    if (!app) return null;
    const selected = String(document.getElementById('cashCurrency')?.value || app.cash?.currency || '').trim();
    return app.cashWallets?.[selected] || (app.cash?.currency === selected ? app.cash : null) || app.cash || null;
  }

  function applyCashUi() {
    installCashUiStyles();

    const withdrawalsTitle = document.getElementById('withdrawalsTitle');
    if (withdrawalsTitle) {
      const month = new Date().toLocaleDateString(undefined, { month:'long' });
      const title = `Withdrawals ${month}`;
      if (withdrawalsTitle.textContent !== title) withdrawalsTitle.textContent = title;
    }

    const host = document.getElementById('recentWithdrawals');
    if (!host) return;
    const wallet = currentCashWallet(readCachedApp());
    const withdrawals = Array.isArray(wallet?.monthWithdrawals)
      ? wallet.monthWithdrawals.slice().sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
      : [];
    const rows = [...host.querySelectorAll('.txnCompact')];

    rows.forEach((row, index) => {
      const withdrawal = withdrawals[index];
      if (!withdrawal) return;
      const main = row.querySelector('.txnCompactMain');
      if (!main) return;
      let meta = main.querySelector('.txnCompactMeta');
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'txnCompactMeta';
        main.appendChild(meta);
      }
      const detail = withdrawalDetail(withdrawal);
      if (meta.textContent !== detail) meta.textContent = detail;
    });
  }

  let cashUiScheduled = false;
  function scheduleCashUi() {
    if (cashUiScheduled) return;
    cashUiScheduled = true;
    queueMicrotask(() => {
      cashUiScheduled = false;
      applyCashUi();
    });
  }

  function applyRelease() {
    applyVersion();
    bindBudgetRefresh();
    installCashUiStyles();
    scheduleCashUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRelease, { once:true });
  } else {
    applyRelease();
  }

  document.addEventListener('change', event => {
    if (event.target?.id === 'cashCurrency') scheduleCashUi();
  });

  const observer = new MutationObserver(() => {
    applyVersion();
    scheduleCashUi();
  });
  observer.observe(document.documentElement, {
    subtree:true,
    childList:true,
    characterData:true
  });
})();
