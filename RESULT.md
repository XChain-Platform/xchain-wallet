# Lane report: cx-xc-5838

## Files touched
- test/e2e/tests/a11y/confirm-a11y.regtest.spec.js
- test/e2e/tests/send/preflight-gate.regtest.spec.js
- packages/core/src/shared/routes/Send.jsx: not touched (no change needed)

## What changed and why
The review finding is right: the local check in Send.jsx (`amountBalanceError`) refuses only amount > balance, so a full 500 of 500 send is valid and the venue dry-run accepts it. The specs would fail at `warmSend(..., false)`. No amount can both pass the local check and be rejected as insufficient funds by the same balance source.

Fix: the two specs are restored to the over-balance send (999999 XCHAIN, which the spec header records the venue rejects with "invalid: insufficient funds"). The local check is bypassed through the product's own balances-hidden switch (`xc:balancesHidden`, see useBalancesHidden.js; `amountBalanceError` returns null while balances are hidden), set after the unlock reload. The restored assertions are the per-finding ack checks (ack-DRYRUN_INVALID then ack-BALANCE_INSUFFICIENT, approve stays disabled until both are ticked), the "Balance of XCHAIN ... does not cover" text and the exact "would be refused because insufficient funds" reason.

## Tests
No regtest venue is available in this lane, so nothing was run. `node --check` only. Pass/fail counts: 0 run.

## For the orchestrator
- Unverified here: that the hidden-balances toggle leaves the Send asset picker and Send button usable on the regtest build. The picker selects rows by data-balance-key, so it should.
- If the toggle approach is unwanted, the only alternative is a venue-side state where the wallet's balance read exceeds the indexer's (stale read), which needs fixtures outside the writable surfaces.

RUN-COMPLETE 3f0cf523b6e1246610c187574a4ae86b
