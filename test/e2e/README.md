# E2E (Playwright)

Browser-driven end-to-end specs against the web SPA (`packages/web`)
via Vite's dev server. Each Playwright test gets a fresh browser
context so IDB + localStorage state don't leak between cases.

## Layout

```
test/e2e/
├── playwright.config.js
├── package.json
├── tests/
│   ├── onboarding/    create + lock + unlock + import flows
│   ├── unlock/        password retries, lockouts, session restore
│   ├── send/          review-stage round-trip, validation
│   └── a11y/          @axe-core/playwright runtime contrast +
│                      focus-visible + keyboard traps (color contrast
│                      lives here because jsdom can't compute styles)
```

## Run

```bash
pnpm test:e2e             # headless
pnpm test:e2e:headed      # with browser UI
```

The config spawns the dev server itself (`pnpm -C ../../packages/web dev`).
If you already have it running, `reuseExistingServer: !CI` picks it up.

## What's NOT covered here

Hardware-signer flows (Trezor / Ledger): need a paired device. Test
in person; doc the path in the runbook at
`packages/extension/docs/TEST_DAPP_RUNBOOK.md`.

Cross-chain real-broadcast: needs the regtest stack at
`~/Sites/XChain-Platform/xchain-node`. Tracked separately.
