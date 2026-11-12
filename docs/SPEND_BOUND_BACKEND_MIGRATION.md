# Lexi Spend: migrate production API to the spreadsheet-bound project

Status: **PREPARATION ONLY — NOT DEPLOYED**. Do not merge or switch app endpoints until the live project is captured and compared. This runbook changes no ledger data, Apps Script deployments, or authentication state.

## Goal

- Keep exactly one production ledger: `LEXI Spend Data`, spreadsheet ID `193q0JQObnwVspUT48QUpWPF_HkgMHKzSyizWy1dH4gc`.
- Use its existing Apps Script project opened via **Extensions → Apps Script** as the single production backend.
- Preserve all existing app features and stored data, including previous transactions, Cash Wallet, receipts, calendar, FX conversions, authentication, and outbox retries.
- Retain the standalone `Lexi Spend API` deployment unchanged during validation as a rollback target.
- Do not modify Travel or Notes.

## Current evidence (2026-11-12)

- GitHub `main` commit: `8234516b9f08fdad3a30b9bf1e4f49f45b87aebe` (Spend frontend v1.15 / GTQ update); GitHub Actions regression run 43308101363: success. **GitHub source is not proof of the code currently deployed in Apps Script.**
- Current frontend references one standalone Apps Script URL:
  - `index.html` (legacy frontend)
  - `v2/api.js` (v2 frontend)
  - `bridge-state.js` (additional bridge)
  Search the complete frontend for the prior deployment URL before any switch.
- Apps Script project contains **five source/configuration files total**: four implementation files listed below **plus `appsscript.json`**. Canonical repository's four implementation files:
  - `apps-script-code.gs` → `Code.gs`
  - `apps-script-v2-api.gs` → `V2Api.gs`
  - `apps-script-auth-transfer.gs` → `AuthTransfer.gs`
  - `apps-script-bridge.html` → `Bridge.html`
- The fifth file, `appsscript.json`, is present in the owner-observed live Apps Script project but not stored in the GitHub repository; preserve the **actual live manifest** rather than reconstructing it by guesswork.
- `Code.gs` uses `SpreadsheetApp.openById(getSpreadsheetId_())`, so binding it does not require replacing the spreadsheet selection logic with `getActiveSpreadsheet()`.

## Gate 0 — snapshot the live Apps Script project

Google supports downloading complete Apps Script projects with `clasp`: https://developers.google.com/apps-script/guides/clasp

Owner:
1. From `script.google.com/home`, open the existing **Lexi Spend API** (standalone); Project Settings → copy its **Script ID**.
2. From the existing `LEXI Spend Data` sheet, open **Extensions → Apps Script** (Chrome) → Project Settings → copy that distinct **Script ID**.
3. Using `clasp clone <Script ID>` in separate *local folders*, pull **both projects**, including the live `appsscript.json`. Snapshot as two ZIPs and supply them for file-by-file comparison. **Never include `~/.clasprc.json` or OAuth tokens.** Keep the old backend deployed.
4. Record active `Lexi Spend API` web-app deployment URL, version, **execute-as** and **who-has-access** settings; compare with the URLs tracked in the frontend. Do not post the API password, session token, or Google OAuth credentials.

This gate FAILS until the live source is captured and compared against GitHub; do not paste GitHub code directly into production before confirming what is currently running.

## Gate 1 — preserve project-specific settings (private, owner only)

Apps Script Script Properties are **not shared** across projects: https://developers.google.com/apps-script/guides/properties

Copy all non-expired property keys and exact values securely from the standalone API to the bound project, without printing values or adding them to GitHub. Relevant keys known from code:

- **Important source divergence:** the supplied live `Code.gs` uses `const SPREADSHEET_ID = '193q0JQObnwVspUT48QUpWPF_HkgMHKzSyizWy1dH4gc'` and `SpreadsheetApp.openById(SPREADSHEET_ID)`. The newer GitHub `Code.gs` instead requires `LEXI_SPEND_SPREADSHEET_ID` Script Property. **The owner confirms the property does not exist in the current live project. Do not blindly replace with repository Code.gs.** Keep the current ID mechanism until an explicit, tested migration of this configuration.- The owner reports **exactly two currently configured Script Properties** in standalone `Lexi Spend API`: `LEXI_SPEND_RECEIPT_ROOT_FOLDER_ID` (receipt root) and `LEXI_SPEND_API_CODE_SHA256` (existing API code hash). Preserve their values privately, without writing them to GitHub. **Never invoke `setupLexiSpendApiCode()`**, which regenerates the API code and invalidates existing authorization.
- `AuthTransfer.gs` contains optional `LEXI_SPEND_GOOGLE_SUB_V1` and `LEXI_SPEND_TRANSFER_SESSIONS_V1`, but the owner confirms neither is currently configured; **do not invent or prepopulate them**. Similarly `country`, `currency`, `symbol` fall back to defaults; do not create values not present in current configuration.
- The owner's Apps Script settings are `America/New_York`, Cloud Logging on, V8 runtime on, and manifest visibility on; the supplied manifest specifies `timeZone: America/New_York`, `runtimeVersion: V8`, `exceptionLogging: STACKDRIVER`, web app `executeAs: USER_DEPLOYING` and `access: ANYONE_ANONYMOUS`. Preserve these when staging and deploying.

Review existing installable triggers, project timezone, OAuth scopes, advanced services, and Google Cloud project association before recreating only those actually needed. Any Google Cloud project change needs explicit sign-in / consent testing. Do not paste private properties into issues, PRs, or chat.

## Gate 2 — stage the bound project (no frontend switch)

1. **Live editor five-file source provided, source comparison completed in part; deployed version NOT independently confirmed.** Use these owner-provided files as migration baseline. Differences from GitHub include: local sheet-bound ID constant vs repo script property requirement; local native date-writing and category normalization vs repo text-date and simplified category handling; GitHub's Nov 6 calendar ATM-fee reporting and Nov 12 GTQ absent in local editor. Resolve each difference with controlled tests and preserve existing live functionality. Compare active deployed version separately; do not discard undocumented functions.
2. In the **existing bound project**, load the verified full source with correct Apps Script file types and names, preserving `appsscript.json` configuration. Do not create another spreadsheet or another unrelated Apps Script project.
3. Copy project-specific Script Properties securely, preserve access, and authorize Google services as owner. Verify project points only at the existing live ledger and correct receipt root.
4. Test **read-only** backend functions, permission scopes, old and new authentication mechanisms, FX/GTQ, and receipt folder access in the new bound project. Never add synthetic expenses to live Transactions or Cash Wallet.
5. Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm test` against the prepared source. Inspect the current release manifest and script version.
6. Deploy a **separate, versioned test web app** of the bound project, matching the original execution and access settings. Verify that its HTML bridge loads and communicates with the correct origin. `/dev` URLs require editor access and are not public replacement URLs.

**Gate 2 FAIL** if the test project has an auth error, broken read, unexpected data mutation, missing configuration, duplicate global function, missing source file, or any regression.

## Gate 3 — coordinated production cutover (owner approval)

1. New bound Apps Script project: **Deploy → New deployment → Web app**, configured like the previously working deployment. Record its new `/exec` URL, version and deployment ID. A deployment of a different script project does not retain the old URL.
2. Update **all** GitHub frontend references to the new URL in one reviewed change. Search again for old URL strings and test both legacy and v2 frontends.
3. Publish a new frontend release using the established versioning and GitHub Pages checks, but do not report complete until verified on the deployed page.
4. Verify authentication continuity and an existing **user-authorized** pending real purchase exactly once under `RELEASE_CHECKS.md`. Compare transaction ID, USD amount, total and outbox status. Do not generate any fake ledger entries or clear local storage.
5. Reopen the app and confirm data persist, Cash Wallet and calendar reconcile, and no duplicate exists.
6. Only after all gates pass: designate the bound project sole production backend in the Canonical Map and private runbook. Archive the superseded deployment after an appropriate rollback window. Keep an immutable backup of the original source and exact deployment mapping.

## Rollback

Leave standalone `Lexi Spend API` untouched while cutover is under validation. On failure, restore the previous GitHub frontend endpoint and redeploy the prior known-good frontend version; confirm the app reconnects to the old Apps Script URL without re-entering or duplicating any pending transaction. Do not purge credentials or data.

## Outstanding evidence

- Actual deployed standalone API source and manifest: **not yet captured**.
- Actual bound project's source and Script ID: **not yet captured**.
- Runtime Script Properties, triggers, execute-as/access configuration: **owner-only; not yet inventoried**.
- Staged end-to-end web-app test: **not run**.
- Production endpoint switch: **not performed**.

No source file, configuration, frontend endpoint, or live deployment was changed by creating this preparation guide.
