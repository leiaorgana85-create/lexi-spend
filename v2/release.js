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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion, { once:true });
  } else {
    applyVersion();
  }

  const observer = new MutationObserver(applyVersion);
  observer.observe(document.documentElement, {
    subtree:true,
    childList:true,
    characterData:true
  });
})();
