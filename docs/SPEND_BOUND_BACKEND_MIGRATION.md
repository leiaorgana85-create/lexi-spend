# Lexi Spend migration: canonical bound backend

**State (2026-11-12): reviewed, code reconciled, tested in isolation, staged in draft PR #26 — NOT deployed.**

## Single source of truth

This PR contains the **five full backend files** in the repository:

- `apps-script-code.gs` → Apps Script `Code.gs`
- `apps-script-v2-api.gs` → `V2Api.gs`
- `apps-script-auth-transfer.gs` → `AuthTransfer.gs`
- `apps-script-bridge.html` → `Bridge.html`
- `appsscript.json` → manifest with original production settings

Complete owner import bundle: `LEXI_Spend_Canonical_Bound_Migration_2026-11-12.zip` provided in the migration chat, with exact same Git blob SHA-1 for each of the five files. This PR's source is not a live deploy. No production sheet write or source cutover has occurred.

## Reconciliation resolution

The source of truth is **the owner's supplied live standalone Apps Script editor code, plus separately tested GitHub improvements**:

1. Native date writes for Transactions and Cash Wallet using the spreadsheet's own timezone `Asia/Bangkok` (independent of the Apps Script project's `America/New_York` setting).
2. Weekly budgeted-only spending totals, with no-limit GLP-1 excluded from the budget limit but included in the full monthly spending total.
3. Legacy `Shopping & Others` category aliases and idempotent retry matching.
4. Existing auth paths, receipt folder, true row expansion, Actual USD formulas, and LockService protection.
5. Add GitHub's missing GTQ/Guatemala mapping and wallet currency. Historical VND retained.
6. Add monthly Calendar ATM-fee entries, counted separately from spending.
7. Use the existing GitHub-style `LEXI_SPEND_SPREADSHEET_ID` Script Property instead of checking in a sheet ID in public source; new bound project will have exactly three configured Script Properties.
8. Preserve the owner-supplied `appsscript.json` byte-identically.

### Live Script Properties

Owner reports **two** configured properties in the current standalone project:
`LEXI_SPEND_API_CODE_SHA256` and `LEXI_SPEND_RECEIPT_ROOT_FOLDER_ID`.
Neither value should be printed, committed, regenerated, or transferred through chat.

On bound project setup, copy these two exact values privately, and **add** `LEXI_SPEND_SPREADSHEET_ID = 193q0JQObnwVspUT48QUpWPF_HkgMHKzSyizWy1dH4gc`.
Do not invent `LEXI_SPEND_TRANSFER_SESSIONS_V1`, `LEXI_SPEND_GOOGLE_SUB_V1` or other optional property values.

## Test evidence

- GitHub Actions `npm test`: **passed** for this migration branch after preserving native-date behavior in test service fixtures and adding `tests/canonical-migration.cjs`.
- Local package `tests/canonical-migration.test.cjs`: **PASS**, 14 isolated checks covering full five-file syntax and combined compile, manifest, API configuration, alias handling, weekly/monthly budgets, GTQ, calendar ATM fees, and real Sheets-date semantics.
- Git blob SHA-1 for five source files: exact match against the owner migration package.
- Live Apps Script deployment/credentials/permissions: **not yet tested**. This is the outstanding gate, not a success claim.

## Import and deployment gates

1. Owner opens the original LEXI Spend Data spreadsheet in Chrome → Extensions → Apps Script. This existing **blank bound project**, not the still-working standalone `Lexi Spend API`, is the migration target.
2. Owner pastes all five files from the source package by correct type and filename. Preserve code exactly; do not paste partial patches.
3. Set the three Script Properties above in the bound project. Preserve the manifest: `timeZone: America/New_York`, V8, Cloud Logging, `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`.
4. In the new bound project, run the read-only `authorizeDriveAccess` and `getAppState` functions and authorize required scopes. If they fail, stop and correct before deployment.
5. Deploy the bound project **as a new Web app** using Execute as Me and access Anyone; record the new `/exec` URL, deployed version and deployment ID. Do not disable or rewrite the old standalone project.
6. Once new URL is known, update all frontend backend-URL references: `index.html`, `bridge-state.js` and `v2/api.js`. Bump visible frontend version, run GitHub CI and post-deploy Pages byte-parity check. Coordinate the cutover so only one endpoint is active for production writes.
7. Verify app authentication, expense/cash read totals, Calendar month and ATM fees, GTQ, receipts and offline outbox without clearing local state. Verify one authorized real pending purchase saves **exactly once** (never create synthetic test transactions in live ledger).
8. Record source commit, full source hashes, old/new deployment IDs, published Pages version and live results in canonical map/private runbook. Only then retire the former standalone API as production endpoint.

**Production change remains blocked until steps 1–8 finish.** The old standalone deployment stays online for verified rollback. Never run a deliberate dual-writer test against the production ledger: Apps Script script-locks are project-scoped.

## Cross-app governance

The same no-patchwork and no-drift release rules are staged in `AGENTS.md` of Spend, Travel, Notes, Music Player, Parents Player and Dad's Music. They are source/release controls, not changes to those apps' live behavior.

## Limitation

GitHub connector tools can change repository files but do not expose Apps Script project source/configuration writes or web-app deployment management. No claim is made that the bound project has been populated or deployed remotely.
