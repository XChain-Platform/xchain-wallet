# Smoke tests

Fast, self-contained Node scripts. Each one exercises a single thin slice
of wiring — module loads, expected exports, route is mounted in the right
shell, button calls the right messaging method, etc. They run in plain
`node` (no Vitest, no jsdom) so they stay cheap.

A smoke fails when:
- A static structural property is broken (route file moved, wrong import
  path, missing handler, schema field renamed).
- A static-text expectation drifts (e.g. a button label change that needs
  the smoke updated).

A smoke does NOT fail just because runtime behaviour misbehaves under load
or a hardware signer disconnects — those belong in `chaos/`, `boundary/`,
`integration/`, or `e2e/`.

## Layout

```
test/smoke/
├── _run-smokes.js         walker / runner — drops a smoke anywhere = picked up
├── setup.js               (placeholder)
├── core/                  decoder, action-decoder, branding, i18n, shared-routes
├── audits/                CI gates: a11y, repro-build, manifest, sdk-bundle,
│                          sdk-wiring, release-gates, vitest-setup, phase-scope
├── onboarding/            extension + web onboarding, freewallet migration, unlock
├── shells/                popup, web, desktop wiring + send-from-web
├── ui/                    Button-adjacent primitives, animated QR reduced-motion,
│                          chart panel, scanner, home-lock
├── bridge/                dApp bridge end-to-end + approval-broker / approval-screens
├── messaging/             messaging inbox / compose / contacts
├── signers/               signer-port protocol, scaffold, UI, HW factories,
│                          ledger / trezor / remote / hw-sign-e2e
├── multisig/              §22 multisig: address derivation, create wizard,
│                          per-config schema, PSBT round-trip, signing session
├── actions/               §40+ action authoring forms (issue / mint / destroy /
│                          token-admin / token-wizard / broadcast / dividend /
│                          airdrop / coinpay / swap / link / parallel /
│                          cross-chain / advanced)
├── dispensers/            dispenser-form / dispensers-list / dispenser-explorer
├── contracts/             VM contract list / detail / deploy / execute / funds
├── staking/               stake-form / staking-action / staking-dashboard /
│                          delegation / operator-dashboard
├── markets/               markets-list / market-view / orderbook / open-orders /
│                          recent-trades / trade-history / place-order
└── addresses/             address-list / receive-view / history
```

## Run

```bash
pnpm test:smoke                              # everything
node test/smoke/audits/a11y-audit.smoke.js   # one specific smoke
node test/smoke/_run-smokes.js               # equivalent to test:smoke
```

## Conventions

- Filename: `<topic>.smoke.js`. One topic per file.
- Top-of-file comment: what wiring this asserts and why a future
  refactor would break it.
- Last line: `console.log('OK — <topic> smoke (<one-line summary>)')`
  so failures are self-locating in CI logs.
- `cwd` is the wallet repo root (`spawnSync` sets it). Smokes
  resolve project files via plain `packages/...`.
- New smokes drop into the right subdirectory and are picked up
  automatically — no manifest, no allowlist.
