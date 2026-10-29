(() => {
  'use strict';

  const VERSION = 'v1.08';

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

  function applyRelease() {
    applyVersion();
    bindBudgetRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRelease, { once:true });
  } else {
    applyRelease();
  }

  const observer = new MutationObserver(applyVersion);
  observer.observe(document.documentElement, {
    subtree:true,
    childList:true,
    characterData:true
  });
})();
