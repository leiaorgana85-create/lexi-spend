# Lexi Spend

Personal spending PWA for the Lexi Apps Ecosystem.

## Migration status

The current production Spend Log remains live and unchanged while this repository is used to build and test the replacement frontend in parallel.

Production baseline audited on 2026-10-12:
- Apps Script web app deployment: Version 4
- Backend app version: `v13.12.21`
- Google Sheet: `Spend Log`
- Spreadsheet timezone: `Asia/Bangkok`
- Apps Script project timezone: `America/New_York` (intentional legacy/fallback setting; do not change casually)

Read-only architecture proof completed on 2026-10-13:
- New standalone Apps Script project: `Lexi Spend API`
- Linked to a standard Google Cloud project
- Google Apps Script API enabled
- Google Drive API enabled
- API Executable deployed with access restricted to the owner
- GitHub Pages frontend successfully obtained Google OAuth authorization and called `apiProbe()` through `scripts.run`
- `apiProbe()` successfully read the existing `Spend Log` and returned timezone `Asia/Bangkok`
- No Sheet write was performed by the proof

## Target architecture

```text
iPhone / Safari-installed PWA
        ↓
GitHub Pages frontend
        ↓
authenticated API layer
        ↓
Apps Script backend
        ↓
Spend Log Google Sheet + receipt folder
```

The existing Apps Script-hosted frontend remains the fallback until the GitHub version passes regression testing.

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

The migration should preserve existing server-side business logic wherever practical and replace `google.script.run` with a small frontend API abstraction.

## Sheet contracts

Do not silently change these schemas during the frontend migration.

### Transactions

Columns A:O are app-owned and currently follow this contract:

`Date | Merchant | Category | Payment Method | Local Amount | Currency | FX Rate to USD | USD Amount | Country | Note | Logged At | FX Source | Entry ID | Receipt Link | Receipt File ID`

### Cash Wallet

Columns A:L are app-owned and currently follow this contract:

`Date | Cash Received | Currency | Reference FX Rate to USD | Estimated Cash USD | ATM Fee | Estimated ATM Fee USD | Exact Bank USD Debit | Country | Note | Logged At | Entry ID`

### Stays

The `Stays` tab owns stay names and dates. The app reads stay configuration from the Sheet; changing a stay should not require a frontend redeploy.

## Migration guardrails

- Do not modify or retire the existing production Apps Script deployment until the replacement passes regression testing.
- Do not expose private Google Sheet IDs, receipt-folder IDs, OAuth client secrets, access tokens, or other credentials in this public repository.
- Do not redesign the Sheet merely to support the new frontend.
- Preserve transaction-date semantics: the normal frontend sends an explicit local `YYYY-MM-DD` date; the Apps Script timezone is only a fallback for server-side paths.
- Test authentication in an installed iPhone PWA before connecting all write operations.
- Test reads first, then writes, then receipt handling, then deletion/reconciliation paths.

## Regression checklist before cutover

- App startup / `getAppState`
- FX preview
- Dashboard refresh
- Expense save
- Expense delete
- Cash Wallet read
- ATM withdrawal save
- ATM withdrawal delete
- Receipt upload
- Receipt delete
- Stay-period display and calculations
- iPhone standalone launch
- Google authentication persistence
- No browser chrome
- No Google Apps Script warning in the visible frontend

## Cutover rule

The existing Spend Log app remains installed and usable as the fallback until the GitHub PWA has been validated against the same Sheet and receipt storage for several days.
