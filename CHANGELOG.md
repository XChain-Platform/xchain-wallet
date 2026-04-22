# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-04-22

### Added

**`@xchain-wallet/core/storage`** — persistent-state facade (§11.2)
- `Vault` class with `open()` / `save()` / `clear()` / `close()` lifecycle and per-collection handles (`vault.wallets`, `accounts`, `addresses`, `contacts`, `connectedSites`, `pendingTxs`) plus singleton `vault.settings`
- Per-collection API: `get(id)`, `list()`, `put(record)` (with schema validation), `delete(id)`, `count()`, `findBy(field, value)`
- Migration-on-read — records auto-upgrade via the schema migration harness on their way out of the vault
- Auto-save-per-mutation default; `autoSave: false` lets shells batch explicitly
- Abstract `StorageBackend` contract; `InMemoryBackend` ships in `core` for tests and the no-wallet-yet empty state
- `codec.js` — document-level encrypt/decrypt via the shared AES-256-GCM AEAD. `documentVersion` header gates future codec breakage; missing collections default to `[]` so forward-compatible reads stay clean
- Master-key lifecycle: `Vault` holds a private copy, zeros it on `close()`. AAD passthrough lets shells scope the vault to a wallet id or origin
- `VaultStateError` (pre-open / post-close operations) and `VaultValidationError` (put with invalid record, carries `collection` + per-field errors)

**`@xchain-wallet/core/crypto/counterwallet`** — legacy Counterwallet mnemonic import (§15.2)
- Canonical 1626-word wordlist vendored from `Mnemonic.js` v1.1.0 (Yiorgis Gozadinos / Crypho AS, MIT) with attribution header — no runtime dep on a stale npm package
- `validateCounterwalletMnemonic(str) → { ok, errors }` with word-level diagnostics; tolerates whitespace and mixed case
- `counterwalletMnemonicToSeedBytes(str)` returns the 16-byte raw seed (Counterwallet has no PBKDF2 stretching — the decoded bytes feed directly into BIP32 `HDKey.fromMasterSeed`)
- `counterwalletMnemonicToSeedHex(str)` convenience hex form
- Verified against the reference Mnemonic.js implementation for 100 random seed round-trips

### Changed
- `SoftwareSigner.unlock` now routes by `walletEncryption.format`:
  - `'bip39'` (default) — existing behavior with optional §15.6 passphrase
  - `'counterwallet-legacy'` — Counterwallet decoder; BIP39 passphrase explicitly rejected
- `@xchain-wallet/core` root barrel adds `storage` namespace alongside `schemas` / `registry` / `signers` / `crypto`

## [0.3.0] - 2026-04-22

### Added

**`@xchain-wallet/bridge-spec`** — complete dApp-bridge surface (§43)
- Full TypeScript definitions for `window.xchain`: `XChainProvider`, per-method param/return types, permission shapes, error codes
- Sign-in with XChain v1 challenge format + `formatSignInChallenge` / `parseSignInChallenge` helpers
- Reference client (`client.ts`): `getProvider({ timeoutMs })` discovery, `PROVIDER_READY_EVENT`, `generateNonce`, `makeSignInParams`, `validateSignInChallenge`
- Global `Window.xchain` augmentation so dApps get IDE completion

**`@xchain-wallet/test-dapp`** (new package) — reference dApp exercising the bridge
- `MockXChainProvider` implementing the full `XChainProvider` interface; configurable `autoApprove` / `rejectAll` / `supportedActions` for testing both paths
- `runExample()` worked example covering connect → getAccounts/Addresses/Balances → signIn → signMessage → signAction(SEND) → signAction(ISSUE)→UNSUPPORTED_ACTION → disconnect
- Compile-time conformance check: if `MockXChainProvider` compiles against `XChainProvider`, the interface is internally coherent

**`@xchain-wallet/core/schemas`** — data-model schemas (§11)
- Eight record schemas: `Wallet`, `Account`, `Address`, `Contact`, `ConnectedSite`, `MultisigConfig` (reserved; validator only), `Settings`, `PendingTx`
- Per-schema `createXxx(input)` factories, `validateXxx(record) → { ok, errors }` validators, JSDoc typedefs
- Shared enums (`NETWORKS`, `ACTION_PERMISSIONS`, `ADDRESS_SOURCES`) and dep-free validation primitives
- Forward-only migration harness (`migrate(record, migrations, target)`) with empty per-schema maps ready for future version bumps
- Sensible defaults: `ADS_DEFAULT_ENABLED = true`, 1 sat per tx, 1000 sat trigger, 5-sec undo-send grace, 15-min autolock

**`@xchain-wallet/core/registry`** — chain registry (§9.7)
- `ChainRegistry` class with `get` / `has` / `supportedChains` / `byCoin` / `byNetworkKind` / `coins` / `derivationPathFor` / `addCustom` / `removeCustom`
- Nine bundled descriptors: bitcoin/dogecoin/litecoin × mainnet/testnet/regtest
- Real BIP44/49/84/86 derivation paths from §16.1; address types per chain (BTC: p2pkh/p2sh-p2wpkh/p2wpkh/p2tr, LTC: first three, DOGE: p2pkh only)
- `validateChainDescriptor` with cross-field check that every declared `addressType` has a derivation-path template
- Canonical `COMMON_ACTIONS` (20) + `BTC_EXCLUSIVE_ACTIONS` (9) sourced from `xchain-documentation/protocol/actions/`
- Developer-Mode custom-chain path: `addCustom` sets `isUserAdded = true`; `removeCustom` refuses bundled

**`@xchain-wallet/core/signers`** — signer interface (§17)
- Abstract `Signer` class with the full §17.1 contract (`id` / `displayName` / `kind` / `requiresPhysicalConfirmation` / `getStatus` / `getAddresses` / `signPsbt` / `signMessage` / `getPublicKey` / `subscribe`)
- Error classes: `AbstractMethodError`, `SignerLockedError`, `SignerStatusError`, `NotImplementedError`
- `SoftwareSigner` (§17.2): real `unlock({ password, bip39Passphrase? })` and `getPublicKey({ chainId, path })`; `getAddresses` / `signPsbt` / `signMessage` stay stubbed pending SDK integration
- Memory hygiene: `lock()` zeros seed + mnemonic bytes + imported WIF bytes; derived keys zeroed after every `getPublicKey` call

**`@xchain-wallet/core/crypto`** — cryptographic foundations (§11.4, §15–16)
- `kdf.js` — Argon2id via `@noble/hashes`, `makeFreshKdfParams` / `calibrateKdfParams({ targetMs })` for per-device ~1-second tuning
- `aead.js` — AES-256-GCM via Web Crypto `SubtleCrypto`; 12-byte random IVs; AAD binding; `iv || ct(||tag)` output format
- `mnemonic.js` — BIP39 wrap (`generateBip39Mnemonic` / `isValidBip39Mnemonic` / `bip39MnemonicToSeed` / entropy round-trip) via `@scure/bip39`
- `hd.js` — BIP32 wrap (`hdKeyFromSeed`, `derive(root, path)` returning `{ privateKey, publicKey, chainCode, publicKeyHex, fingerprint, path }`) via `@scure/bip32`
- `wif.js` — chain-agnostic WIF encode/decode via `@scure/base` base58check
- `walletBlob.js` — pairs KDF + AEAD with the Wallet schema's `encryptedSeed` + `kdfParams` fields; master key zeroed after use
- Verified against official BIP39 vectors (Trezor set) and BIP32 spec vectors

### Changed
- `@xchain-wallet/bridge-spec` upgraded from stub to full surface
- `@xchain-wallet/core` root barrel now re-exports `schemas` / `registry` / `signers` / `crypto` namespaces
- `@xchain-wallet/core` declares `@noble/hashes`, `@scure/base`, `@scure/bip32`, `@scure/bip39` as runtime dependencies

### Infrastructure
- `pnpm-lock.yaml` committed per §9.8 dependency-hygiene rules

## [0.2.0] - 2026-04-22

### Added
- pnpm workspace scaffolding (`pnpm-workspace.yaml`)
- Shared TypeScript config for JS+JSDoc type-checking (`tsconfig.base.json`)
- CI skeleton (`.github/workflows/ci.yml`) — installs deps; typecheck/lint/test/build steps wired as placeholders until packages define them
- Documentation home (`docs/README.md`) with planned-contents list
- Phase 1 package stubs: `@xchain-wallet/core`, `@xchain-wallet/bridge-spec`, `@xchain-wallet/web`, `@xchain-wallet/extension`, `@xchain-wallet/desktop`
- `bridge-spec` TypeScript configuration (`packages/bridge-spec/tsconfig.json`) — emits `.d.ts` for dApp-developer consumption
- MV3 manifest stub (`packages/extension/manifest.json`)
- `packageManager` field pinned to `pnpm@9.0.0`
- Workspace-wide scripts: `typecheck`, `lint`, `test`, `build` (all via `pnpm -r --if-present`)

### Changed
- `README.md` repository-layout section now annotates scaffolded vs Phase-2-pending vs not-yet-started items

## [0.1.0] - 2026-04-22

### Added
- Repository seeded with standard XChain Platform project metadata: `LICENSE.md`, `NOTICE.md`, `README.md`, `CHANGELOG.md`, `package.json`, `.gitignore`
