# E2E (Playwright)

Browser-driven end-to-end specs against the web SPA (`packages/web`)
via Vite's dev server. Each Playwright test gets a fresh browser
context so IDB + localStorage state don't leak between cases.

## Layout

```
test/e2e/
├── playwright.config.js
├── package.json
├── fixtures/
│   └── wallet.js      the shared cold-browser -> unlocked-Home walk
└── tests/
    ├── onboarding/    welcome, create/lock/unlock, import, license gate
    ├── send/          validation, confirm stage, and (regtest only) the
    │                  multi-recipient round trip: three recipient rows, one
    │                  signature, every leg read back off the chain
    ├── betting/       BET create -> bet -> resolve round trip (regtest only:
    │                  it signs four actions and reads the settled balances
    │                  back off the chain)
    └── a11y/          @axe-core/playwright WCAG 2.1 A/AA scans
                       (color contrast lives here because jsdom can't
                       compute styles)
```

The a11y suite asserts zero violations at the **WCAG 2.1 Level A + AA** tag
severity, scanned via `@axe-core/playwright`. The scan itself lives in
`fixtures/a11y.js`, because a11y coverage is split across two venues and both
must agree on what counts as a violation:

- `tests/a11y/a11y.spec.js` (dev config) scans every screen up to the Send
  form.
- `tests/a11y/confirm-a11y.regtest.spec.js` (regtest config) scans the
  **confirm surface** in both §4.2 verdict states at both widths. It runs
  there because those verdicts have to come from a real compose + preflight
  against a chain, which only the regtest venue has.

## Start from the fixture

`fixtures/wallet.js` owns the walk from a cold browser to an unlocked Home
(`createWallet`, `unlockWallet`, `lockWallet`, `gotoSection`, ...). **Use it.**
Do not re-implement onboarding in a spec.

That is not a style preference. Onboarding is the most-churned surface in the
wallet: it has since grown a license gate, a recovery-phrase verification stage
and an ADS donation-consent screen. Every spec used to inline its own copy of
the create-wallet walk, so all 15 of them broke at the first click, at once.

The fixture also **bypasses the license gate** by seeding the acceptance keys
the app reads, because that gate is not what most specs are testing and clicking
through it would couple every spec to legal copy. The version is imported from
the app's own `buildInfo.js`, never hardcoded: acceptance is version-bound, so a
stale literal would silently re-fire the gate in front of every spec. The gate
itself is covered, once, by `onboarding/license-gate.spec.js`, which opts out
with `test.use({ acceptLicense: false })`.

Names repeat across surfaces ("Send" is a nav item, a Home quick action, AND the
send form's submit), so say which one you mean: `gotoSection(page, 'Send')` vs
`mainButton(page, 'Send')`. A bare `getByRole('button', { name: 'Send' })`
resolves to three elements and trips strict mode.

## Run

```bash
pnpm test:e2e             # headless
pnpm test:e2e:headed      # with browser UI
```

The config spawns the dev server itself (`pnpm -C ../../packages/web dev`).
If you already have it running, `reuseExistingServer: !CI` picks it up.

CI runs this suite on every push (the `e2e` job in `.github/workflows/ci.yml`).
It is deliberately NOT part of `pnpm run ci`: that gate must stay fast and must
not need a browser or a dev server. But it does have to run *somewhere*, or it
dies the way it died before - the specs, the config and the browsers were all
present and correct, and nothing executed them.

## Known failures encoded in the suite

Two defects are recorded as tests rather than hidden. Both are written so they
**fail once the bug is fixed**, forcing the exception out along with the fix:

- ** (palette contrast).** The default light theme's semantic colours fail
  WCAG AA for text: accent `#1E90C7` at 3.57:1, success `#16A34A` at 3.29:1,
  warning `#D97706` at 2.74:1. `tokens.css` already carries AA-compliant
  variants under its forced high-contrast block, so only the default theme is
  non-compliant. The a11y spec quarantines exactly these token colours (every
  other rule, and every other colour, still fails the build) and asserts the
  debt still reproduces.
- ** (signing is a silent no-op).** In this shell the dev-mock SDK cannot
  sign and throws by design, but the rejection is swallowed: "Sign on Bitcoin"
  leaves the confirm stage untouched with no alert, no busy state and not even a
  console error. Marked `test.fail()`, so Playwright still runs it and will fail
  the suite if it ever passes.

## What's NOT covered here

Real signing + broadcast: the dev server serves the dev-mock SDK, so specs stop
at the confirm stage. Those flows live in the regtest venue
(`playwright.regtest.config.js`), which serves a production build against a
real chain.

## Which SDK this venue runs on 

The dev config pins the venue with `VITE_XCHAIN_REAL_SDK: '0'` on its
`webServer`, and `packages/web/src/sdkFactory.js` reads that flag before it
imports anything. Set `VITE_XCHAIN_REAL_SDK=1` to run the dev shell on the real
`xchain-sdk` instead; the same flag is what tells Vite to pre-bundle it.

Say the venue out loud, always. It used to be decided by *catching* the SDK
import failure: the dev server could not transform the linked CJS SDK, so the
mock got used by accident. The day Vite learned to pre-bundle it, the import
started succeeding, the dev shell silently moved onto the real SDK against
mainnet explorers this browser cannot reach, and five specs went red with
"Couldn't send. The network is unreachable." A test venue that flips when a
bundler improves is not a venue.

Hardware-signer flows (Trezor / Ledger): need a paired device. Test
in person; doc the path in the runbook at
`packages/extension/docs/TEST_DAPP_RUNBOOK.md`.

Shell-specific surfaces (extension service worker, Electron IPC, web IndexedDB):
G164.
