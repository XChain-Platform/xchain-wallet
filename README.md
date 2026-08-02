<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# XChain Platform Wallet

<p align="center">
  <img src="https://img.shields.io/badge/version-0.334.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-388%20smokes%20%2B%20Playwright%20E2E-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/node-%3E%3D22-green" alt="Node">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shells-web%20%7C%20extension%20%7C%20desktop%20%7C%20mobile-blueviolet" alt="Shells">
  <img src="https://img.shields.io/badge/signers-software%20%7C%20Trezor%20%7C%20Ledger%20%7C%20Remote%20%7C%20MuSig2-blueviolet" alt="Signers">
  <img src="https://img.shields.io/badge/coverage-unit%20%7C%20smoke%20%7C%20integration%20%7C%20boundary%20%7C%20security%20%7C%20fuzz%20%7C%20chaos%20%7C%20regression%20%7C%20a11y%20%7C%20mutation%20%7C%20bench%20%7C%20e2e-brightgreen" alt="Coverage">
</p>

Self-custodial multi-chain wallet for the XChain Platform. Runs as a browser web app, a Chrome MV3 extension (popup + full-screen), a desktop application (Windows / macOS / Linux), and a native Android app, all from a single React codebase (an iOS app is next). Bitcoin, Dogecoin, and Litecoin at launch; additional chains added as the platform adds them. The wallet consumes [xchain-sdk](https://github.com/XChain-Platform/xchain-sdk) as its only data and signing layer and never duplicates SDK functionality.

## Features

- **Four shells, one codebase:** `@xchain-wallet/web` (Vite SPA), `@xchain-wallet/extension` (Chrome MV3 popup + full-screen + service worker), `@xchain-wallet/desktop` (Electron with main-process signing isolation), `@xchain-wallet/mobile` (Capacitor shell wrapping the same web build, Android now with iOS to follow); all share `@xchain-wallet/core` for routes, components, flows, and signers
- **All 29 XChain ACTIONs:** SEND, ISSUE, MINT, DESTROY, ORDER, DISPENSER, DIVIDEND, SWEEP, SWAP, AIRDROP, MESSAGE, LIST, LINK, BROADCAST, PRICE, VOTE, BATCH, DEPLOY, EXECUTE, DEPOSIT, WITHDRAW, COINPAY, STAKE, UNSTAKE, DELEGATE, COLLECT, CALLBACK, SLEEP, FILE
- **Self-custodial key management:** BIP39 mnemonic + optional 25th-word passphrase, BIP32 HD derivation per chain, AES-256-GCM vault encrypted with an Argon2id-derived master key (calibrated per device), Counterwallet legacy mnemonic import
- **Pluggable signer interface:** `SoftwareSigner` (in-vault keys), `TrezorSigner` (Trezor Connect, all current models), `LedgerSigner` (WebHID, all current models), `RemoteSigner` (cross-shell pairing), `MultisigSigner` (classical n-of-m + MuSig2 sessions)
- **Full token issuance suite:** issue, mint, destroy, distribute, dividend, dispenser create + buy + close, broadcast, airdrop with parsed-recipients preview, sweep, and sell-ownership (lists token ownership for sale via ORDER/DISPENSER with price-in-BTC or token inputs)
- **Programmable token policy:** bind a controller contract to a token (`ControllerBindForm`) to delegate issuance authority and transfer rules to an on-chain contract; unbind restores direct-owner control
- **Built-in DEX surface:** token markets list, market view with lightweight-charts price chart, place-order panel, orderbook, recent trades, open orders, trade history
- **Encrypted messaging inbox:** ECIES (multi-device default), ECDH (session), and AES (pre-shared); full inbox + compose flow over the SDK MessageManager
- **Smart contracts:** deploy from source, execute methods through a manual lane or, when the contract declares an ABI, an auto-generated method selector with named/typed parameter inputs, deposit + withdraw, contracts-list / contract-detail explorer views, gas estimation, ContractClient bindings
- **BTC staking + delegation:** STAKE (VERSION 1 new / VERSION 2 top-up, auto-detected from existing stakes for the entered pubkey), pubkey-based UNSTAKE, DELEGATE (v0/v1 rotate; v2/v3 revoke), COLLECT; staking dashboard, delegation form, operator dashboard. Capability-based model: a pubkey's aggregate stake auto-qualifies it for each of four independent capabilities (`price`, `cross_chain`, `oracle_publish`, `attestation`)
- **My Tokens & Manage Token:** issuer dashboard listing all tokens owned by active addresses; per-token admin surface with Mint / Destroy / Lock supply / Update description / Transfer ownership / Create dispenser / Pay dividend / Airdrop / Broadcast
- **Privacy mode:** masks amounts in history detail, activity rows, open orders, and group summaries; per-account toggle persisted across sessions
- **Automatic Donation System (ADS):** opt-out (consent captured at onboarding) per-chain micro-donation on each submitted action; invisible after setup with no line on sign screens; configurable per chain in Settings; a single `ADS_DEFAULT_ENABLED` constant controls the default without touching flows
- **Cross-chain flows:** cross-chain swap form, cross-chain templates (parallel composer for atomic multi-chain submission), per-chain SDK registry, link/swap coordinators
- **Multisig coordinator:** create n-of-m configs, paste-inbox for partial PSBTs, AnimatedQrFrames PSBT-QR transport, multisig session state machine, MuSig2 session round labels, schema-v2 multi-config-per-address support, camera scanner, co-signer account provisioning with a policy editor and account list/detail views
- **Chain-registry sync:** the web, extension, and desktop shells fetch the hub's signed chain list at startup, verify it against a pinned key, and add new or updated chains automatically without touching any chain you added yourself
- **Command palette and keyboard shortcuts:** Cmd/Ctrl+K opens a fuzzy search over pages, actions, and contacts; a starter set of global shortcuts (lock, send, settings, help) plus single-key navigation, with a shortcut-help screen, in the web, extension, and desktop shells
- **Governance-poll notifications:** the wallet flags a new VOTE poll for a token you hold, calling out binding polls explicitly (toggle in Settings, all three desktop-class shells)
- **dApp bridge (`window.xchain`):** typed bridge spec at `@xchain-wallet/bridge-spec`: connect, getAccounts, getBalances, signMessage, signPsbt, signAction, signIn (Sign-In with XChain), event subscriptions; per-origin permission grants enforced in the extension service worker and desktop main process
- **Air-gapped PSBT signing:** BIP21 / multisig PSBT envelope / chunked PSBT-QR encoding; QR scanner + AnimatedQrFrames for offline cosigner round-trips; `prefers-reduced-motion` honored with manual frame stepping
- **Sign message / verify signature:** sign arbitrary text with any address (BIP322-compatible) and verify counterparty signatures; output is copyable; gated behind password re-entry in the sensitive-action flow
- **Sign-screen safety rails:** plain-English action decoder shows `to` / `amount` / `asset` as you typed them, even if the encoder fabricates output; multi-step approval requires explicit user confirmation; per-action expectation summaries
- **Onboarding and recovery:** create / import / Counterwallet-migrate / dry-run-restore / discover-used-addresses (gap-limit scan); view-private-key + export-WIF gated behind password re-entry
- **Lock / unlock / auto-lock:** Argon2id-derived session key cached in `chrome.storage.session` (extension) or in-memory (web/desktop); foreground auto-lock on idle; manual lock action; OS keychain auto-unlock on desktop
- **i18n + a11y:** string registry under `core/src/i18n`; static a11y audit gate (button label / img alt / input label / textarea label / div-onclick role+tabIndex) blocks regressions in CI; WCAG 2.2 AA target for the external audit
- **Reproducible builds:** Level-2 reproducibility of the pre-signing Linux desktop bundle: digest-pinned base image, frozen lockfile, `SOURCE_DATE_EPOCH` from `git log`, `RELEASE_HASHES.txt` SHA-256 manifest, 18-rule static repro-build audit gate
- **URI scheme handling:** registered handlers for `bitcoin:`, `dogecoin:`, `litecoin:`, and `xchain:` URIs across every shell, including `xchain:{COIN}/execute` links that open a prefilled contract-execute screen
- **Connected sites + permissions:** per-origin grant store, revocable from Settings, surfaced in the approval popup before every privileged action

## Documentation

Full wallet documentation lives in the [xchain-documentation](https://github.com/XChain-Platform/xchain-documentation/tree/master/components/wallet) repository:

| Document | Description |
|---|---|
| [README](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/README.md) | Overview, shell matrix, package layout, usage modes |
| [Architecture](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/architecture.md) | Repo layout, package boundaries, state flow, three-shell model, core/web/extension/desktop seams |
| [Keys & Signing](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/keys-signing.md) | BIP39 + passphrase, HD derivation, vault encryption, signer interface, software / Trezor / Ledger / Remote / Multisig |
| [Security & Threat Model](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/security.md) | Protected assets, in-scope and out-of-scope threats, sign-screen safety rails, audit posture |
| [UX Surfaces](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/ux.md) | Onboarding, lock/unlock, balances, history, send/receive, sign screens, contacts, QR scanner, command palette, settings |
| [Features](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/features.md) | Token issuance, DEX, messaging, dispensers, contracts, staking, multisig, cross-chain; surface-by-surface |
| [Bridge](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/bridge.md) | `window.xchain` dApp bridge: connect, signMessage, signPsbt, signAction, signIn, events, error codes |
| [URI Schemes](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/uri-schemes.md) | BIP21 + chain URIs + multisig PSBT envelope + chunked PSBT-QR transport |
| [Multisig](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/multisig.md) | Classical n-of-m + MuSig2: create flow, paste inbox, session state machine, PSBT-QR cosigner round-trips |
| [Shell - Extension](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/shell-extension.md) | Chrome MV3 architecture, manifest, service worker, content script, injected provider, approval popup |
| [Shell - Desktop](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/shell-desktop.md) | Electron main / renderer split, OS keychain, WebHID hardware transports, electron-builder packaging, auto-updater |
| [Shell - Web](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/shell-web.md) | Vite SPA, mobile responsiveness, extension-detect banner, session-only key handling |
| [Build & Release](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/build-release.md) | Synchronized versioning, Chrome Web Store submission, electron-builder, signing, release-hashes |
| [Reproducible Builds](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/reproducible-builds.md) | Level-2 reproducibility: scope, scaffolding audit, run-twice verification, drift sources |
| [Testing](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/testing.md) | Smoke gates, Playwright E2E, a11y audit, repro-build audit, manifest audit, bridge-e2e, hw-sign-e2e |
| [Configuration](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/wallet/configuration.md) | Per-chain endpoints, custom RPC, signer registration, settings store, developer mode |

## Status

Pre-v1.0 (current version: `0.334.0`). All four implementation phases (Phase 1: framework; Phase 2: issuance + hardware; Phase 3: DEX + messaging; Phase 4: contracts + staking + cross-chain + multisig) are closed. The autonomous portion of the §56.3 pre-launch track is also closed; three user-driven items remain before v1.0.0 GA: external security audit, external accessibility audit, and Chrome Web Store submission. Audit-readiness packets ship with the repo.

## Quick Start

```bash
git clone https://github.com/XChain-Platform/xchain-wallet.git
cd xchain-wallet
pnpm install
```

No sibling checkout is needed. The shells depend on the SDK as a published package, `npm:@dankest-llc/xchain-sdk@X.Y.Z`, installed under the folder name `xchain-sdk` so every `import 'xchain-sdk'` works unchanged. `pnpm install` is all it takes, and the lockfile pins the exact version a release is built and signed over.

**Working on the SDK and the wallet at the same time:**

```bash
pnpm run sdk:link      # point node_modules at a local checkout
pnpm run sdk:status    # show which SDK each shell is resolving
pnpm run sdk:unlink    # go back to the pinned published version
```

`sdk:link` looks for `../xchain-sdk` and takes `--sdk <path>` or `XCHAIN_SDK_PATH` otherwise. It changes nothing but symlinks inside `node_modules`, so no manifest or lockfile edit can escape into a commit and quietly un-pin the SDK for everyone else. Forgetting to run it gives you the pinned package, which is the safe direction to fail in.

### Run the web SPA

```bash
pnpm --filter @xchain-wallet/web dev
```

Vite serves the wallet at `http://localhost:5173`. The web shell is mobile-responsive; open it on a phone for the mobile UX. A native Android app is also in progress (`@xchain-wallet/mobile`, a Capacitor shell around this same web build): the build itself is done, and it is not yet published to the Play Store. An iOS app is planned to follow.

### Build the Chrome extension

```bash
pnpm --filter @xchain-wallet/extension build
```

`packages/extension/dist/` is the unpacked extension. In Chrome / Edge / Brave, open `chrome://extensions`, enable Developer Mode, click *Load unpacked*, and select `dist/`. The popup, full-screen, and approval views all run from this single build.

### Run the desktop app

```bash
pnpm --filter @xchain-wallet/desktop start
```

Builds the renderer and launches Electron locally. For packaged releases:

```bash
pnpm --filter @xchain-wallet/desktop dist           # signed installers per platform
pnpm --filter @xchain-wallet/desktop dist:unpacked  # pre-signing Linux bundle (reproducible)
pnpm --filter @xchain-wallet/desktop reproduce      # rebuild and verify against RELEASE_HASHES.txt
```

### Build the Android app

```bash
pnpm --filter @xchain-wallet/mobile sync           # stage the web build into www/ and run `cap sync android`
cd packages/mobile/android && ./gradlew bundleRelease
```

`@xchain-wallet/mobile` ships no JavaScript of its own; `www/` is a byte-for-byte copy of the web shell's production build. The Gradle build needs JDK 21 and the Android SDK. See [`packages/mobile/README.md`](packages/mobile/README.md) for the current build/release status.

### Run the smoke suite

```bash
pnpm test:smoke                                    # 388 smoke tests (plain Node: UI surfaces, signers, bridge, audits)
pnpm --filter @xchain-wallet/e2e test              # Playwright E2E against the web shell
```

## Repository Layout

```
xchain-wallet/
├── package.json                 workspace root, single source of truth for version
├── pnpm-workspace.yaml          packages/* + e2e
├── tsconfig.base.json           shared TS config (JS + JSDoc throughout)
├── packages/
│   ├── core/                    React components, state, flows, signers, schemas, SDK integration
│   ├── web/                     browser SPA shell (Vite)
│   ├── extension/               Chrome MV3 extension shell (popup + full-screen + service worker)
│   ├── desktop/                 Electron desktop shell (Windows / macOS / Linux)
│   ├── mobile/                  Capacitor mobile shell (Android now, iOS to follow); wraps the web build
│   ├── signers-ledger/          LedgerSigner vendor implementation, extracted from core
│   ├── signers-trezor/          TrezorSigner vendor implementation, extracted from core
│   ├── bridge-spec/             window.xchain TypeScript type definitions
│   └── test-dapp/               reference dApp exercising the bridge
├── tools/
│   └── build-reproduce/         reproducible-build helper scripts
├── e2e/                         Playwright E2E suite (web shell)
├── docs/                        in-repo architecture + threat-model + dependency notes
├── CHANGELOG.md                 Keep a Changelog format; root is authoritative
├── LICENSE.md / NOTICE.md       GNU Affero General Public License v3.0 (AGPL-3.0)
└── README.md                    this file
```

All packages ship at the **same version**. Every shell's About screen surfaces its own `package.json.version` so users can confirm the extension, web, and desktop builds came from the same codebase.

## Scripts

Root scripts run across all packages via `pnpm -r`:

| Command | Description |
|---|---|
| `pnpm test` | Run every package's tests (vitest smokes + audits) |
| `pnpm build` | Build every shell's production artifact |
| `pnpm typecheck` | Run package-level typecheck where defined |
| `pnpm lint` | Run package-level lint where defined |

Per-package scripts (run with `pnpm --filter <pkg> <script>`):

| Package | Command | Description |
|---|---|---|
| root | `pnpm test:unit` | Vitest unit suite |
| root | `pnpm test:unit:watch` | Vitest in watch mode |
| root | `pnpm test:unit:coverage` | Vitest with v8 coverage |
| root | `pnpm test:smoke` | Direct node runner for headless smokes |
| `@xchain-wallet/web` | `dev` | Vite dev server at `http://localhost:5173` |
| `@xchain-wallet/web` | `build` | Production SPA bundle to `dist/` |
| `@xchain-wallet/web` | `preview` | Serve the production bundle locally |
| `@xchain-wallet/extension` | `build` | Production MV3 build to `dist/` |
| `@xchain-wallet/extension` | `dev` | Watch-mode build for development |
| `@xchain-wallet/desktop` | `start` | Build renderer and launch Electron |
| `@xchain-wallet/desktop` | `build` | Build renderer only |
| `@xchain-wallet/desktop` | `dist` | Signed installers via electron-builder |
| `@xchain-wallet/desktop` | `dist:unpacked` | Pre-signing Linux bundle (reproducible target) |
| `@xchain-wallet/desktop` | `reproduce` | Rebuild and verify against `RELEASE_HASHES.txt` |
| `@xchain-wallet/e2e` | `test` | Playwright E2E suite against the web shell |
| `@xchain-wallet/e2e` | `install:browsers` | One-time Playwright browser download |

## Test Suite

| Type | Tests | Description |
|---|---|---|
| Smoke - ui | 174 | Shared components plus per-screen coverage (watcher-mode, a11y, draft persistence) across nearly every route |
| Smoke - audits | 40 | a11y, extension-manifest, repro-build, release-gate, chain-registry-refresh, and other CI-gating checks |
| Smoke - actions | 38 | Per-ACTION composer forms: issue, mint, destroy, dispenser, dividend, airdrop, swap, cross-chain, token wizard, gated content, oracle price, and more |
| Smoke - core | 27 | Fee estimation, price lookup, i18n, RBF, settings flow, lockout tracking, panic mode, biometric unlock, action decoder |
| Smoke - shells | 16 | Desktop keychain / packaging / hardening, mobile clipboard / shell / vault, popup / web / extension-sidepanel shells |
| Smoke - markets | 14 | Order placement, orderbook, trade history, market view/list, swaps, obligations center |
| Smoke - bridge | 12 | `window.xchain` dApp bridge, approval broker/screens, origin allow/blocklist, PSBT-QR, sign-throttle |
| Smoke - signers | 12 | Software, Trezor, Ledger, Remote, Multisig signer wiring, firmware manifest, hw-sign-e2e |
| Smoke - multisig | 8 | Create, signing, PSBT-QR, multi-config, cosigner accounts |
| Smoke - onboarding | 8 | Create / import / Counterwallet-migrate flows, license gate, quiz, partner pairing |
| Smoke - staking | 8 | Stake / delegation forms, staking list, operator dashboard, claim/cooldown |
| Smoke - dispensers | 7 | Create, detail/edit, escrow alert, list, explorer, lifecycle |
| Smoke - contracts | 6 | Contract detail/list, deploy/execute forms, funds form, consent manifest |
| Smoke - addresses | 5 | Active address, add-address modal, address list, history, receive view |
| Smoke - security | 4 | CSP, SRI, SPV-verified mode, no-Trezor dist guard |
| Smoke - messaging | 3 | Compose, contacts, inbox |
| Smoke - governance | 3 | Binding-poll detection, deadline watcher, VOTE flow |
| Smoke - desktop / docs / wallet | 3 | Pending-tx detach on window close, glossary appendix check, add-wallet backup mode |
| **Smoke total** | **388** | All run on every commit; CI fails on any regression |
| Playwright E2E - web (default) | 9 specs | Onboarding, add-wallet activation, license gate, send-form review, command palette, a11y scans, responsive viewports, keyboard shortcuts |
| Playwright E2E - regtest | 45 specs | Betting, fees, contracts, dispensers, oracle, DEX, tokens, addresses, send, a11y against a live regtest chain |
| Playwright E2E - extension | 4 specs | Cosigner approval, confirm-resume, reservation-race, service-worker kill/rehydration |
| Repro-build verification | Manual | Run `packages/desktop/scripts/reproduce.sh <tag>` twice on a clean dev machine; diff `RELEASE_HASHES.txt` |

## Versioning

Every package under `packages/` **ships at the same version number** as the root. The root `package.json` version is the single source of truth; each sub-package's `package.json` tracks it in lockstep, and so does `packages/extension/manifest.json`, which is the copy the Chrome Web Store reads. `CHANGELOG.md` at the repo root is authoritative; sub-packages do not maintain their own changelogs.

**`test/e2e` is exempt.** It is a private test harness that is never published or installed by a user, so its version identifies nothing and tracking the root would be ceremony. It carries its own version deliberately.

The membership rule is "everything under `packages/`" rather than a list of names, because a list is what let this drift in the first place: six packages sat a patch version behind the root while this paragraph claimed otherwise, and nothing noticed (). `test/smoke/audits/version-lockstep.smoke.js` now enforces it, and a newly added package is in scope the moment it exists.

## Parent Platform

XChain Wallet is the reference client for the [XChain Platform](https://github.com/XChain-Platform). The platform is a blockchain-agnostic token protocol running on Bitcoin, Dogecoin, and Litecoin, with a built-in DEX, sandboxed JavaScript smart contracts, encrypted messaging, and cross-chain swaps, all encoded directly into standard blockchain transactions. See the platform [README](https://github.com/XChain-Platform/xchain-documentation/blob/master/README.md) for a list of every component and how they connect.

## Contributing

Contribution guide, code of conduct, and security-disclosure policy land alongside the v1.0.0 GA cut. Until then, the existing in-repo notes at [`docs/`](./docs/) capture the current architecture, threat model, and dependency review.

## Legal

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later) with a commercial license available for proprietary use.

| Document | Description |
|---|---|
| [LICENSE](./LICENSE.md) | Full license text |
| [NOTICE](./NOTICE.md) | Required attribution, license summary, and third-party notices |

Any redistribution or modification must include the attribution notice specified in [NOTICE.md](./NOTICE.md). Commercial use requires prior written consent from Dankest, LLC. See [LICENSE.md](./LICENSE.md) for details.

---

**Copyright &copy; 2026 Dankest, LLC**

**Based on XChain Platform by Dankest, LLC &ndash; https://dankest.llc**

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later)
with a commercial license available for proprietary use.

You may use, modify, and distribute this material under the terms of the License.
See [LICENSE](./LICENSE.md) and [NOTICE](./NOTICE.md) for full terms.
See the [licensing overview](https://docs.xchain.io/legal/LICENSING.html).
