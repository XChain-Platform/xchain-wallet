<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# XChain Platform Wallet

<p align="center">
  <img src="https://img.shields.io/badge/version-0.333.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-295%20smokes%20%2B%20Playwright%20E2E-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/node-%3E%3D22-green" alt="Node">
  <img src="https://img.shields.io/badge/license-Dankest%20Community-orange" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shells-web%20%7C%20extension%20%7C%20desktop-blueviolet" alt="Shells">
  <img src="https://img.shields.io/badge/signers-software%20%7C%20Trezor%20%7C%20Ledger%20%7C%20MuSig2-blueviolet" alt="Signers">
  <img src="https://img.shields.io/badge/coverage-unit%20%7C%20smoke%20%7C%20a11y%20%7C%20e2e%20%7C%20bridge%20%7C%20repro--build-brightgreen" alt="Coverage">
</p>

Self-custodial multi-chain wallet for the XChain Platform. Runs as a browser web app, a Chrome MV3 extension (popup + full-screen), and a desktop application (Windows / macOS / Linux), all from a single React codebase. Bitcoin, Dogecoin, and Litecoin at launch; additional chains added as the platform adds them. The wallet consumes [xchain-sdk](https://github.com/XChain-platform/xchain-sdk) as its only data and signing layer and never duplicates SDK functionality.

## Features

- **Three shells, one codebase:** `@xchain-wallet/web` (Vite SPA), `@xchain-wallet/extension` (Chrome MV3 popup + full-screen + service worker), `@xchain-wallet/desktop` (Electron with main-process signing isolation); all share `@xchain-wallet/core` for routes, components, flows, and signers
- **All 27 XChain ACTIONs:** SEND, ISSUE, MINT, DESTROY, ORDER, DISPENSER, DIVIDEND, SWEEP, SWAP, AIRDROP, MESSAGE, LIST, LINK, BROADCAST, ADDRESS, BATCH, DEPLOY, EXECUTE, DEPOSIT, WITHDRAW, COINPAY, STAKE, UNSTAKE, DELEGATE, COLLECT, CALLBACK, SLEEP, FILE
- **Self-custodial key management:** BIP39 mnemonic + optional 25th-word passphrase, BIP32 HD derivation per chain, AES-256-GCM vault encrypted with an Argon2id-derived master key (calibrated per device), Counterwallet legacy mnemonic import
- **Pluggable signer interface:** `SoftwareSigner` (in-vault keys), `TrezorSigner` (Trezor Connect, all current models), `LedgerSigner` (WebHID, all current models), `RemoteSigner` (cross-shell pairing), `MultisigSigner` (classical n-of-m + MuSig2 sessions)
- **Full token issuance suite:** issue, mint, destroy, distribute, dividend, dispenser create + buy + close, broadcast, airdrop with parsed-recipients preview, sweep
- **Built-in DEX surface:** token markets list, market view with lightweight-charts price chart, place-order panel, orderbook, recent trades, open orders, trade history
- **Encrypted messaging inbox:** ECIES (multi-device default), ECDH (session), and AES (pre-shared); full inbox + compose flow over the SDK MessageManager
- **Smart contracts:** deploy from source, execute methods, deposit + withdraw, contracts-list / contract-detail explorer views, gas estimation, ContractClient bindings
- **BTC staking + delegation:** STAKE (VERSION 1 new / VERSION 2 top-up, auto-detected from existing stakes for the entered pubkey), pubkey-based UNSTAKE, DELEGATE (v0/v1 rotate; v2/v3 revoke), COLLECT; staking dashboard, delegation form, operator dashboard. Capability-based model: a pubkey's aggregate stake auto-qualifies it for each of four independent capabilities (`price`, `cross_chain`, `oracle_publish`, `attestation`)
- **My Tokens & Manage Token:** issuer dashboard listing all tokens owned by active addresses; per-token admin surface with Mint / Destroy / Lock supply / Update description / Transfer ownership / Create dispenser / Pay dividend / Airdrop / Broadcast
- **Privacy mode:** masks amounts in history detail, activity rows, open orders, and group summaries; per-account toggle persisted across sessions
- **Cross-chain flows:** cross-chain swap form, cross-chain templates (parallel composer for atomic multi-chain submission), per-chain SDK registry, link/swap coordinators
- **Multisig coordinator:** create n-of-m configs, paste-inbox for partial PSBTs, AnimatedQrFrames PSBT-QR transport, multisig session state machine, MuSig2 session round labels, schema-v2 multi-config-per-address support, camera scanner
- **dApp bridge (`window.xchain`):** typed bridge spec at `@xchain-wallet/bridge-spec`: connect, getAccounts, getBalances, signMessage, signPsbt, signAction, signIn (Sign-In with XChain), event subscriptions; per-origin permission grants enforced in the extension service worker and desktop main process
- **Air-gapped PSBT signing:** BIP21 / multisig PSBT envelope / chunked PSBT-QR encoding; QR scanner + AnimatedQrFrames for offline cosigner round-trips; `prefers-reduced-motion` honored with manual frame stepping
- **Sign-screen safety rails:** plain-English action decoder shows `to` / `amount` / `asset` as you typed them, even if the encoder fabricates output; multi-step approval requires explicit user confirmation; per-action expectation summaries
- **Onboarding and recovery:** create / import / Counterwallet-migrate / dry-run-restore / discover-used-addresses (gap-limit scan); view-private-key + export-WIF gated behind password re-entry
- **Lock / unlock / auto-lock:** Argon2id-derived session key cached in `chrome.storage.session` (extension) or in-memory (web/desktop); foreground auto-lock on idle; manual lock action; OS keychain auto-unlock on desktop
- **i18n + a11y:** string registry under `core/src/i18n`; static a11y audit gate (button label / img alt / input label / textarea label / div-onclick role+tabIndex) blocks regressions in CI; WCAG 2.2 AA target for the external audit
- **Reproducible builds:** Level-2 reproducibility of the pre-signing Linux desktop bundle: digest-pinned base image, frozen lockfile, `SOURCE_DATE_EPOCH` from `git log`, `RELEASE_HASHES.txt` SHA-256 manifest, 18-rule static repro-build audit gate
- **URI scheme handling:** registered handlers for `bitcoin:`, `dogecoin:`, `litecoin:`, and `xchain:` URIs across all three shells
- **Connected sites + permissions:** per-origin grant store, revocable from Settings, surfaced in the approval popup before every privileged action

## Documentation

Full wallet documentation lives in the [xchain-documentation](https://github.com/XChain-platform/xchain-documentation/tree/master/components/wallet) repository:

| Document | Description |
|---|---|
| [README](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/README.md) | Overview, shell matrix, package layout, usage modes |
| [Architecture](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/ARCHITECTURE.md) | Repo layout, package boundaries, state flow, three-shell model, core/web/extension/desktop seams |
| [Keys & Signing](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/Keys_Signing.md) | BIP39 + passphrase, HD derivation, vault encryption, signer interface, software / Trezor / Ledger / Remote / Multisig |
| [Security & Threat Model](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/SECURITY.md) | Protected assets, in-scope and out-of-scope threats, sign-screen safety rails, audit posture |
| [UX Surfaces](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/UX.md) | Onboarding, lock/unlock, balances, history, send/receive, sign screens, contacts, QR scanner, command palette, settings |
| [Features](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/FEATURES.md) | Token issuance, DEX, messaging, dispensers, contracts, staking, multisig, cross-chain; surface-by-surface |
| [Bridge](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/BRIDGE.md) | `window.xchain` dApp bridge: connect, signMessage, signPsbt, signAction, signIn, events, error codes |
| [URI Schemes](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/URI_Schemes.md) | BIP21 + chain URIs + multisig PSBT envelope + chunked PSBT-QR transport |
| [Multisig](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/MULTISIG.md) | Classical n-of-m + MuSig2: create flow, paste inbox, session state machine, PSBT-QR cosigner round-trips |
| [Shell - Extension](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/Shell_Extension.md) | Chrome MV3 architecture, manifest, service worker, content script, injected provider, approval popup |
| [Shell - Desktop](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/Shell_Desktop.md) | Electron main / renderer split, OS keychain, WebHID hardware transports, electron-builder packaging, auto-updater |
| [Shell - Web](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/Shell_Web.md) | Vite SPA, mobile responsiveness, extension-detect banner, session-only key handling |
| [Build & Release](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/Build_Release.md) | Synchronized versioning, Chrome Web Store submission, electron-builder, signing, release-hashes |
| [Reproducible Builds](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/Reproducible_Builds.md) | Level-2 reproducibility: scope, scaffolding audit, run-twice verification, drift sources |
| [Testing](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/TESTING.md) | Smoke gates, Playwright E2E, a11y audit, repro-build audit, manifest audit, bridge-e2e, hw-sign-e2e |
| [Configuration](https://github.com/XChain-platform/xchain-documentation/blob/master/components/wallet/CONFIGURATION.md) | Per-chain endpoints, custom RPC, signer registration, settings store, developer mode |

## Status

Pre-v1.0 (current version: `0.333.0`). All four implementation phases (Phase 1: framework; Phase 2: issuance + hardware; Phase 3: DEX + messaging; Phase 4: contracts + staking + cross-chain + multisig) are closed. The autonomous portion of the §56.3 pre-launch track is also closed; three user-driven items remain before v1.0.0 GA: external security audit, external accessibility audit, and Chrome Web Store submission. Audit-readiness packets ship with the repo.

## Quick Start

```bash
git clone https://github.com/XChain-platform/xchain-wallet.git
cd xchain-wallet
pnpm install
```

The repository depends on a sibling `xchain-sdk` checkout. Both `packages/web/package.json` and `packages/extension/package.json` link `xchain-sdk` from `../../../xchain-sdk`. Clone [xchain-sdk](https://github.com/XChain-platform/xchain-sdk) next to `xchain-wallet` before installing.

### Run the web SPA

```bash
pnpm --filter @xchain-wallet/web dev
```

Vite serves the wallet at `http://localhost:5173`. The web shell is mobile-responsive; open it on a phone for the mobile UX while native iOS / Android apps are on the post-launch roadmap.

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

### Run the smoke suite

```bash
pnpm test:smoke                                    # 295 smoke tests (plain Node: UI surfaces, signers, bridge, audits)
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
| Smoke - UI surfaces | 64 routes | Onboarding, Home, Send, Receive, History, Issue, Mint, Destroy, Dispenser, Dividend, Airdrop, Broadcast, Compose, Markets, Place-Order, Orderbook, Recent-Trades, Open-Orders, Trade-History, Multisig-Create, Multisig-Signing, Cross-Chain, Parallel, Stake, Delegation, Operator, Contracts, Contract-Detail, Execute, Deploy, Funds, Messaging-Inbox, Address-List, Token-Wizard, Token-Admin, Migrate-to-BIP39, Pair-Signer, View-Private-Key |
| Smoke - UI primitives | 9 | Button, Input, Screen, ChainBadge, AddressText, CopyButton, MultisigBadge, AnimatedQrFrames, QrScanner |
| Smoke - Signers | 8 | Software, Trezor, Ledger, Remote, Multisig, hw-factories, hw-sign-e2e, signer-port-protocol |
| Smoke - Bridge & approval | 5 | bridge-e2e, approval-broker, approval-screens, popup-shell, web-shell |
| Smoke - Flows & decoder | 6 | sdk-wiring, sdk-bundle, action-decoder, decoder, freewallet-migration, unlock-flow |
| Smoke - Audits | 4 | a11y-audit, repro-build-audit, extension-manifest-audit, release-gates |
| Smoke - Other | ~6 | i18n, branding, phase-scope, shared-routes, ui-surface, vitest-setup |
| **Smoke total** | **295** | All run on every commit; CI fails on any regression |
| Playwright E2E | 3 specs | Onboarding round-trip, Send-form review, axe-core a11y scan of every Phase-1 screen |
| Repro-build verification | Manual | Run `packages/desktop/scripts/reproduce.sh <tag>` twice on a clean dev machine; diff `RELEASE_HASHES.txt` |

## Versioning

All packages in this repository (root, `packages/core`, `packages/extension`, `packages/web`, `packages/desktop`, `packages/bridge-spec`, `packages/test-dapp`, and `e2e`) **ship at the same version number**. The root `package.json` version is the single source of truth; every sub-package's `package.json` tracks the root in lockstep. `CHANGELOG.md` at the repo root is authoritative; sub-packages do not maintain their own changelogs.

## Parent Platform

XChain Wallet is the reference client for the [XChain Platform](https://github.com/XChain-platform). The platform is a blockchain-agnostic token protocol running on Bitcoin, Dogecoin, and Litecoin, with a built-in DEX, sandboxed JavaScript smart contracts, encrypted messaging, and cross-chain swaps, all encoded directly into standard blockchain transactions. See the platform [README](https://github.com/XChain-platform/xchain-documentation/blob/master/README.md) for a list of every component and how they connect.

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
See the [licensing overview](https://docs.xchain.io/legal/licensing).

## License

XChain Platform is **open source**, dual-licensed under:

- the **[GNU Affero General Public License v3.0](./LICENSE.md)** (`AGPL-3.0-or-later`), free for everyone, and
- a **[commercial license](https://docs.xchain.io/legal/commercial-license)** for companies that need to keep modifications private.

See the **[licensing overview](https://docs.xchain.io/legal/licensing)** for which one applies to you. "XChain" is a trademark of Dankest, LLC. See the **[Trademark Policy](https://docs.xchain.io/legal/trademark)**.

Copyright © 2025-2026 Dankest, LLC.
