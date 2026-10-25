# Lexi Spend change and release rules

Preserve local outbox records and stable Entry IDs. Never clear app data to fix sync.

Before completing a change:
- Run `npm ci --ignore-scripts --no-audit --no-fund` when dependencies need installation, then `npm test`.
- For a backend change, test both canonical Code.gs and the supported legacy case. Do not mock the application helper being changed; mock Google services at their boundary. A mocked test does not establish deployed compatibility.
- Keep frontend publication and Apps Script deployment separate in status reports. GitHub source parity does not prove live backend parity.
- Follow RELEASE_CHECKS.md. Do not report a sync issue fixed end to end until an authorized real pending purchase is confirmed in the live Google Sheet, the pending marker clears, and retry does not create a duplicate. If this cannot be checked, state that live verification is pending.
- Do not create synthetic purchases in the user's production ledger. Use isolated fixtures for automated checks.
