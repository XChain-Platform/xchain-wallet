# Lane report: cx-xc-5837

## Files touched
- test/e2e/tests/tokens/airdrop.regtest.spec.js
- test/e2e/tests/tokens/content-registry.regtest.spec.js

## What changed
- The success screens render a txid through AddressText as first6...last6; the full 64 hex lives only in the element title and aria-label. Both specs' approveAndGetTxid now read innerText plus those attributes, so a 64 hex id is found.
- The list rename done screen (ListRenameForm.jsx) prints no transaction id at all ("List rename submitted."). That is an app gap outside Surfaces, so the rename step now waits on that message and relies on the existing explorer name poll as proof. The acceptance wording "rename success screen shows a 64 hex id" needs an app change (render the id in ListRenameForm.jsx) and is parked for the orchestrator.

## Tests
- node --check on both specs: 2 pass, 0 fail.
- Regtest e2e (airdrop.regtest.spec.js:862, content-registry.regtest.spec.js:167) NOT run here: needs the regtest CI stack. Pass/fail unverified.

## Notes
- The brief asked to merge develop first; the run contract requires building on base commit 6d280e86 only, so no merge was done. The airdrop spec conflict with develop is unresolved and may need a follow-up.
- Base in the brief (0fc6c645) differs from the contract base; the contract base was used.

RUN-COMPLETE 3ec7b212a2f6520122df744ead697f0c
