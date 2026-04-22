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

## Repository layout (target, not yet in place)

```
xchain-wallet/
├── package.json                 # workspace root
├── pnpm-workspace.yaml
├── LICENSE.md / NOTICE.md       # Dankest Community License
├── CHANGELOG.md                 # Keep a Changelog format
├── README.md                    # this file
├── .github/workflows/           # CI
├── docs/                        # architecture docs, dApp-bridge spec
├── packages/
│   ├── core/                    # React components, state, SDK integration
│   ├── web/                     # browser SPA shell
│   ├── extension/               # Chrome MV3 extension (popup + full-screen + background + content-script)
│   ├── desktop/                 # Electron shell
│   ├── signers-trezor/          # TrezorSigner
│   ├── signers-ledger/          # LedgerSigner
│   ├── bridge-spec/             # window.xchain type definitions + reference client
│   └── test-dapp/               # reference dApp exercising the bridge
├── tools/
│   ├── build-reproduce/         # reproducible-build scripts
│   ├── release/                 # signing and packaging
│   └── regtest/                 # regtest environment for E2E
└── e2e/                         # Playwright E2E suite
```

## Parent platform

XChain Wallet is the reference client for the [XChain Platform](https://github.com/XChain-platform). It consumes [xchain-sdk](https://github.com/XChain-platform/xchain-sdk) as its only data and signing layer — the wallet never duplicates SDK functionality.

## Contributing

Contribution guide, code of conduct, and security-disclosure policy will land as implementation begins. Watch this repo for updates.

## License

Licensed under the **Dankest Community License** — see [`LICENSE.md`](./LICENSE.md) and [`NOTICE.md`](./NOTICE.md).

---

**Copyright © 2026 Dankest, LLC**

**Based on XChain Platform by Dankest, LLC — https://dankest.llc**
