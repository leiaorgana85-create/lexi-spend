# Release verification

## Automated checks

The `Spend regression checks` workflow runs `npm test` on pull requests and main pushes.
It checks shipped Apps Script files for unresolved dependencies and duplicate globals,
exercises real canonical budget/category helpers, checks the legacy missing-helper
save/retry path, and runs the frontend outbox, FX, startup and concurrency regressions.
Dependencies are pinned in package-lock.json. No production sheet writes occur.

A passing workflow alone does not prove that the separately deployed Apps Script
matches the source. GitHub branch protection is not configured by this change;
the workflow does not independently prevent an administrator from merging a failure.

## Live acceptance for a sync fix

1. Confirm the deployed frontend assets match the tested commit.
2. Record the Apps Script version deployed to the existing web-app URL. Updating
   source without updating that deployment is incomplete.
3. Retry an existing, user-authorized pending purchase. Confirm it appears exactly
   once in the live Transactions sheet and its pending marker clears.
4. Confirm the app's totals and USD amount reconcile to that sheet row.
5. Reopen the app and confirm the purchase remains confirmed and no duplicate appears.

Never clear local storage or re-enter a pending purchase to force the test to pass.
Do not introduce test purchases into the production ledger. If the user's device
or live sheet cannot be inspected, report the missing verification explicitly.

## Reporting

Distinguish: tested locally; frontend published; Apps Script updated by the user;
live save/retry verified. Use "fixed end to end" only for the last state.
Retain the tested commit, check result, deployed versions and live outcome with the
release or pull-request record. Do not commit private purchase details or credentials.
