# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.16.0] - 2026-04-22

### Changed

**`submitAction` now optionally tracks a PendingTx record (§11.3.8) through the submission lifecycle**
- New optional `pendingTxMeta: { fromAddress, toAddress, actionSummary }`. When supplied, the flow creates a PendingTx at `composing`, advances through `awaiting-signature` → `broadcasting` → `broadcast` (or → `indexed` if `waitForTxid` is supplied), and persists via the vault at every transition
- On error, status transitions to `failed` with the error message recorded; the record is preserved so the history screen (§28) can surface failure reasons instead of losing the submission
- Return shape adds `pendingTxId: string | null` so callers can look up the record later
- Caller's `onProgress` still fires alongside the lifecycle tracker; a thrown `onProgress` does NOT derail the tracker's persistence
- `sendAsset` and `sweepAsset` auto-populate `pendingTxMeta` with generated summaries (`"Send 100 XCP to bc1q… — memo"`, `"Sweep balances + ownerships to bc1q… — memo"`). Opt-out via `trackPendingTx: false`

**The tx-status timeline (§28.4) and RBF/cancel flows (§44.4) can now read live state** — every submitted action leaves a traceable record in the vault without the UI layer needing to intercept progress events.

## [0.15.0] - 2026-04-22

### Added

**`createDemoWallet(opts)`** (§25.2) — ephemeral try-before-commit wallet
- In-memory only (`InMemoryBackend`); nothing ever touches IndexedDB / chrome.storage / file
- Auto-generated 64-char hex password (256 bits) returned to the caller — shell holds it for the session, drops it when the user exits demo
- Intentionally weak KDF (`iterations: 1, memory: 8192`) — the ciphertext never reaches an attacker, so paying ~1s of Argon2id buys nothing and makes demo feel sluggish
- Per-spec the shell does NOT display the mnemonic (nothing useful to back up for a throwaway wallet)
- Default `activeChainIds` is the three regtest chains (no endpoint dependency, no mainnet confusion); overridable
- Returned `{ vault, password, walletId, mnemonic, wallet, account, addresses }` drives every existing flow (unlockWallet / receiveAddress / walletBalances / sendAsset / …) unchanged — demo mode is the same code path with a different backend

## [0.14.0] - 2026-04-22

### Added

**`signMessageFlow(opts)`** and **`signPsbtFlow(opts)`** — standalone user-initiated sign flows (§30.1, §30.4)
- `signMessageFlow({ walletId, password, chainId, path, message, … })` — unlocks, signs, locks. Round-trip verified via real SDK `verifyMessage` on BTC p2wpkh
- `signPsbtFlow({ walletId, password, chainId, psbtHex, signingPaths, … })` — unlocks, signs, locks. Real-PSBT end-to-end test produces a 64-hex-char txid
- Both guarantee `signer.lock()` in a `finally` — seed material zeroed on success and on throw
- Input validation: paths that don't start with `m/`, non-string messages, empty `psbtHex`, and empty `signingPaths` all rejected at the flow boundary with clear errors

## [0.13.0] - 2026-04-22

### Added

**`importWif(opts)`** — add a single imported private key to an existing HD wallet (§15.5)
- Validates the WIF via `sdk.wallet.importWIF` (checksum + chain network match); derives the address via `sdk.wallet.deriveAddress`
- Encrypts the WIF under the same master key that protects the wallet's seed (one password unlocks both); uses the wallet's existing `kdfParams` so the derivation matches
- Creates an `Address` record with `source: 'imported-wif'`, `derivationPath: null`, `accountId: null`, `signerId: walletId` — per §11.3.3's carve-out for non-HD entries
- Appends an `{ addressId, encryptedWif, importedAt }` entry to `Wallet.importedKeys` (§11.3.1); round-trip verified — the stored ciphertext decrypts back to the original WIF under the same password
- Single KDF round per import: the password is verified by decrypting the seed blob, then the same derived master key encrypts the WIF — one Argon2id round, not two
- `InvalidWifError` for malformed / network-mismatched WIFs; `WrongPasswordError` for bad passwords (password check runs before any WIF persistence so a bad-password attempt leaves the wallet unchanged)

## [0.12.0] - 2026-04-22

### Added

**`@xchain-wallet/extension/background`** — MV3 service-worker skeleton
- `MessageHost` — transport-agnostic request/response router with typed handlers. Uniform response envelope `{ ok: true, result } | { ok: false, error: { name, message } }`; synchronous and async handler errors are serialized (the transport never drops a silent failure). `UnknownMessageTypeError` / `InvalidMessageError` for diagnostics
- `createBackgroundHost(deps)` — factory that registers the Phase 1 handler surface: `wallet.list` / `wallet.exists` / `wallet.create` / `wallet.import` / `wallet.checkPassword` / `receive.getAddress` / `action.send` / `action.sweep` / `balances.wallet` / `balances.address` / `history.address`
- Safe-wallet projection: wallet records returned over the wire strip `encryptedSeed` / `kdfParams` / `importedKeys` — narrows the blast radius of any future popup-side logging
- `attachChromeRuntime(host, chromeRuntime?)` — wires the host to `chrome.runtime.onMessage` using the MV3 `return true` + `sendResponse` async-response contract. Returns a detach function for hot-reload / tests; injectable runtime for tests

**`@xchain-wallet/web/storage/IndexedDBStorageBackend`** — primary-store adapter for the browser SPA target (§11.2)
- Wraps raw IndexedDB with a minimal Promise surface; bytes ↔ base64 at the wire boundary (same pattern as the Chrome backend, avoids cross-browser typed-array round-trip quirks)
- `KeyValStore` injectable adapter lets tests run against a Map-backed mock without fake-indexeddb; production lazy-opens a real database + object store
- Defaults: `DEFAULT_DB_NAME = 'xchain-wallet'`, `DEFAULT_STORE_NAME = 'vault'`, `DEFAULT_STORAGE_KEY = 'wallet-vault'`
- Full Vault round-trip verified end-to-end through the backend

**`@xchain-wallet/web`** now depends on `@xchain-wallet/core` via `workspace:*`.

## [0.11.0] - 2026-04-22

### Added

**`@xchain-wallet/extension`** — first shell-layer modules
- `ChromeStorageBackend` — `StorageBackend` adapter for MV3 `chrome.storage.local`, the primary persistent store per §11.2. Base64-encodes bytes at the wire boundary (Chrome's structured-clone of `Uint8Array` has historically been unreliable between popup / service-worker contexts)
- `ChromeSessionBackend` — subclass targeting `chrome.storage.session` for ephemeral state (unlocked-session handles, dApp tokens). Default key distinct from local so the two stores can coexist on the same mock in tests and never collide in production
- Both accept an injected `chromeStorage` for tests / non-browser targets; throw session-aware or local-aware errors when no storage is available
- `DEFAULT_STORAGE_KEY = 'xchain-wallet:vault'`, `DEFAULT_SESSION_STORAGE_KEY = 'xchain-wallet:session'`
- Workspace wire-up: `@xchain-wallet/extension` now declares `@xchain-wallet/core` as a `workspace:*` dep
- End-to-end verified: full `Vault` round-trip through `ChromeStorageBackend` — wallet records persisted and retrievable across vault reopens

**`reconcileAddressSigners(opts)`** — closes the Address v1→v2 migration loop (§17.6)
- Walks addresses with `signerId === null`, derives the pubkey from each supplied unlocked signer at the stored `derivationPath`, and writes back the matching signer's id when exactly one matches
- Caller supplies unlocked signers (the function doesn't touch unlock/lock state); fits naturally into `withUnlocked(opts, (signer) => reconcileAddressSigners({ ..., signers: [signer] }))`
- Idempotent; returns `{ scanned, reconciled, skipped[] }` with per-address skip reasons (`no-path` / `unknown-chain` / `no-match`)
- Optional `walletId` and `chainId` filters narrow scope
- `AmbiguousSignerMatchError` thrown if multiple signers derive the same pubkey at the same path — silent ambiguity could misroute future ops, so we fail loudly

**Migration cycle now end-to-end:** the harness (v0.3.0) + the first bump (v0.8.0, Address v1→v2) + the reconciler (this release) demonstrate the full schema-evolution story — forward-only migration on read, followed by runtime reconciliation of any deferred resolution.

## [0.10.0] - 2026-04-22

### Added

**`receiveAddress(opts)`** (§29.7) — derive and persist the next unused external HD address
- Scans persisted addresses scoped to (accountId, chain, network, addressType, source='hd', change=0); parses the BIP44 index from the stored path; derives `max + 1`
- Per-chain and per-addressType scoping: BTC p2wpkh and BTC p2pkh count separately; DOGE and BTC count independently
- Ignores internal change-chain (change=1) addresses when computing the next external index
- Defaults addressType to `descriptor.defaultAddressType`; default label `"Address #N+1"`
- `NoMatchingAccountError` for a missing `accountIndex`
- Real-SDK verified: after `importMnemonic` of the canonical BIP39 test vector, indices 1 and 2 match the canonical BIP84 addresses (`bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g`, `bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z`)

**Balance / history read flows** — `addressBalances`, `addressHistory`, `walletBalances`
- `addressBalances({ sdkRegistry, chainId, address, opts? })` / `addressHistory(...)` — thin pass-throughs to `sdk.getBalances` / `sdk.getHistory(address, 'address', opts)`
- `walletBalances({ vault, walletId, chainRegistry, sdkRegistry, chainId?, opts? })` — wallet-scoped aggregator. Resolves the wallet's account ids → filters addresses → groups by chainId → fetches in parallel per address
- Partial results: one-address fetch failure yields `{ balances: null, error: <message> }`; other entries are unaffected
- Optional `chainId` filter; `opts` forwarded to every call; stray addresses not tied to the wallet and addresses on unknown chains are silently skipped

**`ChainRegistry.chainIdFor(coin, networkKind)`** — reverse lookup from Address record fields (coin + network) to chainId. Enables the balances aggregator and any future flow that needs to route operations per chainId when the input records don't carry it.

**`withUnlocked(unlockOpts, fn)`** / **`withUnlockedRecord(unlockOpts, fn)`** — session helpers
- Unlock → `await fn(signer)` → lock in `finally`. Signer guaranteed locked on resolve *and* reject — no half-unlocked state can leak
- Batches multiple signing ops under one unlock. Argon2id is ~1s per unlock; deriving three addresses under one `withUnlocked` pays one KDF round, not three
- Callback can be async or sync; return value flows through. Nested `withUnlocked` calls each get their own signer with independent lifecycles

## [0.9.0] - 2026-04-22

### Added

**`sendAsset(opts)`** — convenience wrapper for the SEND action (§Phase 1 authoring surface)
- JS-friendly params (`to`, `asset`, `amount`, `memo`, `fee`, `feePerKb`, `rbf`) mapped to protocol field names (`DESTINATION`, `TICK`, `AMOUNT`, `MEMO`)
- `amount` coerced to string so callers can pass numbers; `memo` is omitted from the action string when not supplied
- `from` accepts either a full `Address` record (from the vault) or an explicit `{ address, publicKey, derivationPath }` triple
- Multi-destination SEND (protocol formats v1–v3) intentionally out of scope; drop to `submitAction` for those
- Verified against real `xchain-sdk` to produce the canonical `SEND|0|XCP|100|<addr>|gift` action string

**`sweepAsset(opts)`** — convenience wrapper for the SWEEP action
- JS booleans (`balances`, `ownerships`, `escrows`) mapped to protocol `'1'`/`'0'` strings
- Protocol defaults mirrored: `balances=true, ownerships=true, escrows=false`
- No-op guard: rejects when all three flags are false
- Verified against real `xchain-sdk` to produce the canonical `SWEEP|0|<addr>|1|1|0[|memo]` action string

**`normalizeSource(from, fnName?)`** — shared helper exported from `sendAsset.js`. Duck-types either Address records or `{ address, publicKey, derivationPath }` triples into the triple form; rejects null `derivationPath` (imported-WIF paths don't support HD signing). Available for future single-source flows.

**`seedSettingsForChains(settings, chainRegistry, activeChainIds)`** and **`ensureSettings(vault, chainRegistry, activeChainIds)`** — populate `Settings.fees[chainId]` and `Settings.ads.perChain[chainId]` from chain-descriptor defaults
- Per-chain fee defaults: `strategy = descriptor.feeStrategy.defaultStrategy`, `customSatsPerKb = null`, `rbfByDefault = descriptor.feeStrategy.rbfSupported` (so BTC / LTC default to RBF-on, DOGE to RBF-off)
- Idempotent: existing entries are never overwritten — a user's customized fee strategy or accumulated ADS state survives a second invocation
- `ensureSettings` handles the vault-level read-or-default, seed, and write-back

### Changed

**`_persistHdWallet`** (internal) — added a final step calling `ensureSettings(...)`, so every wallet created through `createWallet` or `importMnemonic` has a valid Settings record with per-chain entries for its active chains. Fees and ADS panels are now renderable without handling an empty-map case.

## [0.8.0] - 2026-04-22

### Added

**`importMnemonic(opts)`** (§15.4 paths 1+2) — user-supplied mnemonic import
- Handles BIP39 (12 / 24 words) and Counterwallet-legacy from one entry point
- Auto-detects format (BIP39 checksum-validated first; Counterwallet as fallback) or validates an explicit `format` against the input
- Normalizes input: trims, collapses whitespace, lowercases — so paste-from-anywhere works
- Counterwallet path explicitly rejects any `bip39Passphrase`
- Default `origin` derived from format (`imported-mnemonic` / `imported-freewallet`); caller can override
- Exports `normalizeMnemonic`, `detectMnemonicFormat` as public utilities
- Error classes: `InvalidMnemonicError` (carries `format` + per-field `errors`), `UnknownMnemonicFormatError`
- Verified against real `xchain-sdk`: `abandon × 11 + about` produces the canonical BIP84 address `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`

**`submitAction(opts)`** — one-call submission wrapper
- Composes `unlockWallet` → `submitWithSigner` → `signer.lock()` in a `finally`
- Seed material is always zeroed — even if `submitWithSigner` throws mid-pipeline
- Returns the full `SubmitResult` from `submitWithSigner`; every shell's "Send" and dApp-sign-request flows can land on this
- For batched submissions under one unlock, callers compose directly — re-unlocking is ~1s of Argon2id

### Changed

**`Address` schema v1 → v2** — §17.6 signer routing
- Added `signerId: string | null` field — stable id of the owning signer (SoftwareSigner uses `wallet.id`); `null` = needs reconciliation
- Added `addressMigrations[1]`: carries v1 records forward with `signerId: null` and documents runtime reconciliation intent
- `validateAddress` accepts `string | null`; rejects numeric/wrong types; new records written at v2 and v1 `put` attempts are rejected
- `createWallet` / `importMnemonic` (via `_persistHdWallet`) populate `signerId = signer.id` on initial addresses — wallets created post-migration are linked from day one

**`createWallet`** — refactored to share post-encryption plumbing with `importMnemonic` via an internal `_persistHdWallet` helper. 175 lines → 84. Same behavior (regression-tested); one source of truth for the persist-new-HD-wallet pipeline.

## [0.7.0] - 2026-04-22

### Added

**`@xchain-wallet/core/flows`** — first full-stack user-facing flows
- `createWallet({ password, vault, chainRegistry, sdkRegistry, activeChainIds, name?, strengthBits?, bip39Passphrase?, kdfParams? })` (§15.3) — generates a BIP39 mnemonic, encrypts it under a device-calibrated Argon2id master key, and persists a ready-to-use wallet: Wallet + first Account (index 0) + first Address per active chain (using each chain's defaultAddressType). Returns the plaintext mnemonic for the §19.2 seed-phrase display ceremony. KDF calibration defaults to ~1s via `calibrateKdfParams`; tests / shells can pre-supply `kdfParams`
- `unlockWallet({ vault, walletId, password, bip39Passphrase?, chainRegistry, sdkRegistry })` — vault lookup + `unlockWalletRecord`; returns an available SoftwareSigner
- `unlockWalletRecord({ wallet, password, bip39Passphrase?, chainRegistry, sdkRegistry })` — the shared primitive for flows that already hold a Wallet record in hand. Locks the signer if unlock throws (no half-unlocked state ever leaks)
- `WalletNotFoundError` — thrown on missing walletId

Round-trip verified: address created at wallet-creation time matches address re-derived after unlock on a fresh signer. Counterwallet-format records unlock through the same primitive (synthetic fixture; seeds the raw 16-byte Counterwallet seed rather than a PBKDF2-stretched BIP39 seed).

End-to-end verified against the real `xchain-sdk`: generated wallet produces valid `bc1q…` / `D…` / `ltc1…` addresses that `sdk.wallet.validateAddress` accepts.

## [0.6.0] - 2026-04-22

### Added

**`submitWithSigner(opts)`** (§10.4) — action submission lifecycle routed through the Signer interface
- Pipeline: `createAction` → `encoder.createTx` → `signer.signPsbt` → `encoder.broadcastTx` → optional P2SH/P2WSH second phase (`spendP2sh` + second sign + second broadcast) → optional indexer wait
- Returns `{ txid, actionString, action, version, encoding, signed, indexed }`; `txid` is always the *final* (phase-2 in P2SH/P2WSH case) txid
- Progress callback fires `creating` / `encoding` / `signing` / `broadcasting` / `p2sh_spending` / `waiting` / `confirmed`
- Indexer wait is opt-in via caller-supplied `waitForTxid(txid, opts)` — the SDK doesn't expose `ActionWaiter` on the instance, so shells wire this themselves (keeps the wrapper decoupled from the polling strategy)
- Strict input validation: missing `encoderOpts.pubkey`, empty `signingPaths`, or uninitialized encoder all throw clear errors
- Verified end-to-end against real `xchain-sdk` with an actual `SEND|XCP|100|...` action: real 64-hex-char ECDSA txid, real action string, full progress sequence

**`adaptXChainSDK(XChainSDKClass)`** — convenience helper that wraps an `XChainSDK` constructor as the `SDKFactory` shape `SDKRegistry` expects; validates the input is a class/function. Shells use it as `sdkFactory: adaptXChainSDK(XChainSDK)` regardless of how they imported the SDK (native ESM / `createRequire` / bundled browser build)

### Changed

**`SoftwareSigner.signMessage`** — two fixes surfaced by real-SDK integration
- Unwraps the SDK's `{ signature, address }` return; formerly was embedding the whole object as the "signature" (which wasn't a string)
- Routes `segwitNative` / `segwitRedeemScript` opts based on the BIP44 purpose in the path: `m/84'` → `segwitNative: true`, `m/49'` → `segwitRedeemScript: true`, `m/44'` → no flags, `m/86'` → explicit `p2tr message signing not supported` error (SDK's `bitcoinjs-message` backend doesn't do taproot)
- Verified round-trip via `sdk.auth.verifyMessage` on BTC p2wpkh, BTC p2sh-p2wpkh, and DOGE p2pkh

## [0.5.0] - 2026-04-22

### Added

**`@xchain-wallet/core/sdk`** — per-chain SDK instance registry (§10.2)
- `SDKRegistry` class: lazy instantiation on `get(chainId)`, instance caching, `initActive(chainIds)` for parallel startup, `invalidate(chainId)` / `invalidateAll()` with `sdk.close()` cleanup hook, `setEndpointOverrides()` for Settings-driven URL overrides
- `SDKFactory` callback pattern — `core` stays SDK-agnostic; shells pass in whatever import path works for their target (`require('xchain-sdk')`, `await import`, or a mock for tests)
- `XChainSDKLike` typedef documenting the minimal SDK surface the wallet depends on
- `UnknownChainError` for unregistered chain ids
- Smart URL join: `:443` / `:80` elided; other ports kept explicit

### Changed

**Chain descriptors** carry `wifVersionByte`
- Added to `ChainDescriptor` shape and validator (`[0,255]` required)
- Bundled values: BTC 0x80 / 0xef (mainnet / test+regtest), LTC 0xb0 / 0xef, DOGE 0x9e / 0xf1

**`SoftwareSigner`** — three previously stubbed methods are now real
- Constructor takes optional `sdkRegistry`; throws a clear error if a delegated method is called without one
- `getAddresses({ chainId, accountIndex, change, startIndex, count, addressType? })` — derives each pubkey via BIP32, calls `sdk.wallet.deriveAddress(pubkeyHex, { type })`. Rejects address types the chain doesn't support. Derived keys zeroed after encoding
- `signPsbt({ psbtHex, chainId, signingPaths })` — derives WIF with chain-appropriate version byte, calls `sdk.wallet.signPsbt`. Phase 1 restriction: all `signingPaths` must share one path; multi-key signing is flagged as a future enhancement
- `signMessage({ message, chainId, path })` — derives WIF, calls `sdk.auth.signMessage`
- All three still gate on `_assertUnlocked()` (`SignerLockedError` when locked)

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
