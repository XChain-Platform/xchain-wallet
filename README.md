<!-- SPDX-License-Identifier: LicenseRef-Dankest-Community -->
<!-- Copyright © 2026 Dankest, LLC -->

# XChain Wallet

<p align="center">
  <img src="https://img.shields.io/badge/status-pre--v1.0%20development-orange" alt="Status">
  <img src="https://img.shields.io/badge/license-Dankest%20Community-orange" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="Node">
</p>

Self-custodial multi-chain wallet for the XChain Platform.

At launch the wallet supports Bitcoin, Dogecoin, and Litecoin, with additional chains added as the XChain Platform adds them. It runs as a browser web app, a Chrome extension (MetaMask-style popup + full-screen), and a desktop application (Windows / macOS / Linux), all from a single codebase. Native iOS and Android apps are on the post-launch roadmap; in the meantime, the browser web app is mobile-responsive.

## Status

Pre-v1.0 development. The implementation is not yet in place.

The design and scope of this project are captured in a complete specification maintained separately from this repository. The spec covers five passes:

1. **Foundation** — architecture, principles, data model, security, threat model
2. **Keys, Signing, Safety** — BIP39 + passphrase, HD derivation, signer interface (software + Trezor + Ledger), backup & recovery, air-gapped PSBT signing, signing-safety rails, multisig foundations
3. **UX Surfaces** — onboarding, lock/unlock, balances, history, send/receive, sign screens, contacts, QR scanner, command palette, keyboard shortcuts, settings, Automatic Donation System, micro-UX polish
4. **Features by Phase** — Phase 1 framework, Phase 2 issuance + hardware, Phase 3 DEX + messaging, Phase 4 contracts + staking + cross-chain + multisig
5. **Integration & Operations** — dApp bridge, fee UX, PRICE oracle integration, notifications, URI schemes, developer mode, offline mode, diagnostics, build & release, testing strategy, accessibility, i18n, license, release plan

## Phased release plan

| Phase | Scope |
|---|---|
| 1 | Framework: core wallet flows, all launch chains, dApp bridge basics, software signing |
| 2 | Token issuance + distribution + dispensers + broadcast + airdrop + hardware wallets |
| 3 | DEX (full trading surface) + encrypted messaging |
| 4 | Smart contracts + BTC staking + cross-chain flows + multisig |
| Launch | All of the above released as v1.0 |

**All four phases ship before public v1.0 launch.** Phases are release units, not tiers of completeness.

## Repository layout

Base scaffolding is in place. Phase 2+ packages and tooling subdirectories are added as implementation proceeds.

```
xchain-wallet/
├── package.json                 # workspace root                  [scaffolded]
├── pnpm-workspace.yaml          #                                 [scaffolded]
├── tsconfig.base.json           # shared TS config for JS+JSDoc   [scaffolded]
├── LICENSE.md / NOTICE.md       # Dankest Community License       [in place]
├── CHANGELOG.md                 # Keep a Changelog format         [in place]
├── README.md                    # this file                       [in place]
├── docs/                        # architecture docs, dApp-bridge  [scaffolded]
├── packages/
│   ├── core/                    # React components, state, SDK    [scaffolded]
│   ├── web/                     # browser SPA shell               [scaffolded]
│   ├── extension/               # Chrome MV3 extension            [scaffolded]
│   ├── desktop/                 # Electron shell                  [scaffolded]
│   ├── bridge-spec/             # window.xchain type definitions  [scaffolded]
│   ├── signers-trezor/          # TrezorSigner                    (Phase 2)
│   ├── signers-ledger/          # LedgerSigner                    (Phase 2)
│   └── test-dapp/               # reference dApp                  (pending)
├── tools/
│   ├── build-reproduce/         # reproducible-build scripts      (pending)
│   ├── release/                 # signing and packaging           (pending)
│   └── regtest/                 # regtest environment for E2E     (pending)
└── e2e/                         # Playwright E2E suite            (pending)
```

## Versioning

All packages in this repository — root, `packages/core`, `packages/extension`, `packages/web`, `packages/desktop`, `packages/bridge-spec`, `packages/test-dapp`, and `e2e` — **ship at the same version number**. The root `package.json` version is the single source of truth; every sub-package's `package.json` tracks the root in lockstep.

Rationale: users running the web app, the extension, and the desktop app need an obvious way to confirm they're on the same build. Every shell's About screen surfaces its own `package.json.version`, so synchronized versions let users diff `0.54.0-extension` vs `0.54.0-web` vs `0.54.0-desktop` and immediately know they're on the same codebase.

**On each release:** bump every `package.json` together. `CHANGELOG.md` at the repo root is authoritative; individual sub-packages do not maintain their own changelogs.

## Parent platform

XChain Wallet is the reference client for the [XChain Platform](https://github.com/XChain-platform). It consumes [xchain-sdk](https://github.com/XChain-platform/xchain-sdk) as its only data and signing layer — the wallet never duplicates SDK functionality.

## Contributing

Contribution guide, code of conduct, and security-disclosure policy will land as implementation begins. Watch this repo for updates.

## License

Licensed under the **Dankest Community License** — see [`LICENSE.md`](./LICENSE.md) and [`NOTICE.md`](./NOTICE.md).

---

**Copyright © 2026 Dankest, LLC**

**Based on XChain Platform by Dankest, LLC — https://dankest.llc**
