# @xchain-wallet/e2e

Playwright end-to-end suite covering the web SPA's Phase-1 flows.

## Run locally

```bash
pnpm install
pnpm --filter @xchain-wallet/e2e install:browsers   # one-time: Playwright browser download
pnpm --filter @xchain-wallet/e2e test
```

The Playwright config spawns Vite's dev server at
`http://localhost:5173` via `pnpm -C ../packages/web dev`. If you already
have the dev server running, `reuseExistingServer: !CI` picks it up so
the suite doesn't fight for the port.

## What's covered today

- **Onboarding** — create + lock + unlock round-trip, wrong-password
  error, import (with a BIP39 test vector), import word-count
  validation.
- **Send form** — review stage round-trip, protocol memo char
  rejection, zero-amount rejection, broadcast attempt surfaces the
  SDK-stub error (proves no hang; same shape as the node-smoke
  coverage in `packages/core/test/web-send.smoke.js`).
- **Accessibility (`tests/a11y.spec.js`)** — `@axe-core/playwright`
  scans every rendered Phase-1 screen (Onboarding / CreateWallet
  password + mnemonic stages / ImportWallet / Home / Locked / Send
  form) for WCAG 2.1 A/AA violations. Fails the build on any hit.

## What's **not** covered

Real signing + broadcast. The web shell currently ships with a
dev-only SDK stub (`hostBridge.js` → `createDevMockSdk`) that produces
pseudo-addresses so onboarding completes. Signing / broadcast
legitimately can't work against that stub. A sibling spec that signs
+ broadcasts on regtest BTC lands once `xchain-sdk` is bundled into
the shell.

dApp-bridge flows (connect, signMessage, signPsbt, signAction) belong
to the extension and are covered end-to-end in
`packages/core/test/bridge-e2e.smoke.js` plus the manual
`packages/extension/docs/TEST_DAPP_RUNBOOK.md`. Extension E2E via
Playwright needs a persistent-context workaround and isn't scoped for
Phase 1.

## Structure

```
e2e/
├── package.json
├── playwright.config.js
├── README.md
├── tests/
│   ├── onboarding.spec.js
│   └── send-form.spec.js
└── test-results/              (git-ignored)
```

## CI

No GitHub Actions workflow while the wallet is under active
development — matches the rest of the xchain-* platform (none of
the sibling services wire CI during the build phase). Run the suite
locally with `pnpm --filter @xchain-wallet/e2e test`. A CI workflow
will be reintroduced once Phase 2 lands.
