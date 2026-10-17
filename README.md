# Lexi Spend

Personal spending PWA for the Lexi Apps Ecosystem.

## Current production status

The GitHub Pages PWA is the current Lexi Spend frontend and the standalone Apps Script project **`Lexi Spend API`** is the Spend backend. Normal spending, cash, receipt and day-to-day tracking is entered through the app; the `Spend Log` Google Sheet is the durable backend ledger/audit surface.

Current resources:
- App: https://leiaorgana85-create.github.io/lexi-spend/
- Repository: https://github.com/leiaorgana85-create/lexi-spend
- Google Sheet: `Spend Log` (`193q0JQObnwVspUT48QUpWPF_HkgMHKzSyizWy1dH4gc`)
- Standalone Apps Script project: **`Lexi Spend API`**
- Apps Script web-app endpoint: `https://script.google.com/macros/s/AKfycby084l1Rupc838tdinecb2J5NCdOurkIa-smKFJqhypYINd_5walm15NLMWH7vSPWrA/exec`
- Backend app version inherited from the production business logic: `v13.12.21`
- Spreadsheet timezone: `Asia/Bangkok`
- Apps Script project timezone: `America/New_York` (intentional legacy/fallback setting; do not change casually)

The GitHub PWA cutover was completed and verified on 2026-10-13. On 2026-10-17, the obsolete bound Apps Script projects named `Spend Log` were removed. Do not recreate or use those legacy projects; the live `Spend Log` spreadsheet remains the durable data source and **`Lexi Spend API`** is the only Spend Apps Script project to maintain.

## Architecture

```text
iPhone / Safari-installed PWA
        ↓
GitHub Pages frontend
        ↓
hidden Apps Script compatibility bridge
        ↓
Lexi Spend API
        ↓
Spend Log Google Sheet + receipt folder
```

The frontend preserves the existing Spend UI and routes the original `google.script.run` call pattern through a compatibility bridge. Google/OAuth/API traffic is not service-worker cached. Same-origin app-shell assets use network-first behavior with offline cache fallback.

Service-worker ownership is path/cache scoped. Current shell cache is `lexi-spend-v35`; activation cleanup may delete only older cache names beginning with `lexi-spend-v`. It must never delete Music, Notes or Parents Player caches on the shared `leiaorgana85-create.github.io` origin. The five `bridge-*.js` auth/transport files are force-fetched with `cache: no-store` before falling back to the Spend cache so an existing PWA cannot silently keep a pre-audit auth bridge after deployment.

## Authentication / Home Screen replacement

- The private Spend API code remains the root/recovery credential. The server validates it using the existing root-code hash; never commit or expose the root code.
- Google account linking is a reinstall bootstrap convenience. The first link requires existing valid Spend authorization on the device.
- After Google verification, the backend issues a separate random `lxs1.` session credential rather than returning the root API code. Session tokens are stored only on the device; Apps Script stores only their SHA-256 hashes plus expiry metadata.
- Spend sessions are currently valid for one year and the backend retains at most 12 active session hashes.
- The linked identity stored in Apps Script is the Google account's stable `sub` identifier, not a Google password or access token.
- Google is **not** requested on every normal app launch. A fresh Home Screen installation may require one Google tap.
- The hidden Apps Script bridge accepts its READY handshake only from the exact iframe created by the PWA and an allowed Google/Apps-Script origin; all later bridge replies must come from the same window/origin.
- A different Google account is rejected by default. If an account mismatch occurs while the device still has a valid root code or `lxs1.` session, the UI exposes **Relink this Google account**; relinking only occurs after that explicit action and backend credential validation.
- The old raw-API-code cookie design is retired. `bridge-state.js` retains only one-time migration/cleanup logic for a historical `lexi_spend_api_code_v1` cookie and deletes it after moving any legacy value into device-local storage.
- The temporary install-token cookie experiment is also retired; the current reinstall design does not intentionally transfer an auth-bearing cookie through GitHub Pages.

Auth implementation files:
- `bridge-state.js` — device-local authorization persistence plus legacy-cookie cleanup.
- `bridge-auth.js` — Google Identity UI, API-code recovery and explicit relink flow.
- `bridge-runtime.js` — exact-iframe bridge handshake and Google auth transport.
- `bridge-call.js` — normal backend call/retry behavior.
- `apps-script-auth-transfer.gs` — Google ID verification, linked-account state, session issuance/hash validation and relink authorization.
- `apps-script-bridge.html` — Apps Script iframe bridge.

**Deployment state, 2026-10-17:** the owner previously deployed the Google-bootstrap version of `AuthTransfer.gs` and `Bridge.html`. The repository now contains an additional audit-hardening pass (exact iframe binding + explicit credential-backed relink), so those two live Apps Script files must be updated and the existing web-app deployment released as a new version before the phone verification. GitHub Pages frontend files, including the scoped v35 service worker, deploy from `main` automatically. End-to-end iPhone replacement verification is still pending.

## Existing backend contract

The current frontend uses these backend functions:

- `getAppState`
- `previewUsd`
- `getDashboard`
- `getCashWallet`
- `uploadReceipt`
- `deleteReceiptFile`
- `logExpense`
- `deleteExpense`
- `addCashWithdrawal`
- `deleteCashWithdrawal`

The GitHub migration preserves the server-side business rules and Sheet contracts; auth/bridge work must not rewrite those financial rules.

## Sheet contracts

Do not silently change these schemas.

### Transactions

Columns A:O are app-owned and currently follow this contract:

`Date | Merchant | Category | Payment Method | Local Amount | Currency | FX Rate to USD | USD Amount | Country | Note | Logged At | FX Source | Entry ID | Receipt Link | Receipt File ID`

### Cash Wallet

Columns A:L are app-owned and currently follow this contract:

`Date | Cash Received | Currency | Reference FX Rate to USD | Estimated Cash USD | ATM Fee | Estimated ATM Fee USD | Exact Bank USD Debit | Country | Note | Logged At | Entry ID`

### Stays

The `Stays` tab owns stay names/dates, rent and stay-specific fixed/extra costs. The app reads stay configuration from the Sheet; changing a stay should not require a frontend redeploy.

## Source-control / deployment discipline

- Fetch the current default-branch target file and current SHA before every GitHub write; make the smallest targeted change; re-fetch afterward.
- `apps-script-auth-transfer.gs` is the repository source for live `AuthTransfer.gs`.
- `apps-script-bridge.html` is the repository source for the live bridge HTML file.
- Changing a GitHub Apps Script copy does **not** update the installed standalone Apps Script project; deploy live Apps Script changes explicitly through the existing deployment so its production URL remains unchanged.
- **Audit gap still open:** the complete current live `Lexi Spend API` main `Code.gs` business-logic file has not yet been captured as an exact repository snapshot. Do not synthesize it from the compressed frontend or old bound-script copies. Capture the exact live `Code.gs` bytes into GitHub when the live source can be read/copied, then verify the repository copy against that source.
- Do not expose private Google Sheet IDs beyond already-established project references, receipt-folder IDs, OAuth client secrets, access tokens, API codes or other credentials in public source.

## Regression checklist

Before calling the current auth/reinstall work verified:

- Existing app opens and current Spend state loads.
- Google link succeeds once on the existing installation.
- Current stay, country and currency are correct.
- Recent transactions/totals load.
- Cash Wallet loads.
- Fresh Home Screen installation can restore access with the linked Google account without entering the private API code.
- Close/reopen preserves the new session.
- Wrong Google account is rejected; explicit relink is offered only when a valid existing credential is present.
- Normal expense/cash/receipt writes still work after auth changes.
- Expense/cash deletion and receipt deletion/reconciliation still work.
- App opens standalone with no browser chrome and no visible Apps Script warning.

Do not remove a known-working Home Screen installation until the replacement installation passes the relevant checks.
