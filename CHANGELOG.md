# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.31.0] - 2026-04-22

### Added

**§9.8 dependency hygiene** — `docs/DEPENDENCIES.md` + CI audit step
- `docs/DEPENDENCIES.md` enumerates every runtime dep per-package with the specific feature it provides, license, and maintainer trust signal. Current runtime deps are all from Paul Miller's audited `@noble/*` + `@scure/*` line; workspace-only for extension / web / test-dapp
- CI `audit` job runs `pnpm audit --prod --audit-level=high` on every PR. Independent of the install job so a failing audit doesn't block typecheck reporting. Moderate advisories surface in logs but don't fail — tracked via the weekly review cadence documented in the file
- Review cadence spelled out: every `package.json` PR updates this file; weekly `pnpm outdated -r` check; advisories jump to the front of the queue regardless

## [0.30.0] - 2026-04-22

### Added

**§43 dApp bridge runtime** — the `window.xchain` provider + content-script + background handlers

Three layers shipped:

1. **Inject script (`src/inject/xchainProvider.js`)** — runs in the page's main world, defines `window.xchain` as a thin RPC shim per §43.2. Every method forwards to the content script via `window.postMessage` with an id-tagged envelope; responses are matched back against pending promises. Emits an `xchain#initialized` event on ready. Frozen after install (`Object.defineProperty` non-writable) so dApps can't swap it mid-session.

2. **Content script (`src/content/contentScript.js`)** — runs in the extension's isolated world on every http/https page. Injects the provider from `web_accessible_resources` at `document_start`, then pure-relays page ↔ background: every outbound request is annotated with `origin: window.location.origin` so the background resolves `ConnectedSite` permissions against a trusted origin, not one sent by the page. Handles `chrome.runtime.lastError` gracefully (extension context invalidation → `RUNTIME_UNAVAILABLE` structured error).

3. **Background handlers (`src/bridge/handlers.js`)** — Phase 1 bridge surface registered against `MessageHost`:
   - `bridge.connect` / `bridge.disconnect` — ConnectedSite lifecycle; first-call-per-origin prompts `Approvals.connect`, subsequent calls are idempotent and update `lastUsedAt`
   - `bridge.getAccounts` / `bridge.getAddresses` / `bridge.getBalances` — scoped to `ConnectedSite.permissions.accounts` + `chains`; `getAddresses` filters by `(coin, network)` from the descriptor; `getBalances` rejects addresses the site isn't permitted to see with `ADDRESS_NOT_PERMITTED`
   - `bridge.getSupportedChains` / `bridge.getActiveChains` — registry enumeration; `getActiveChains` reads seeded per-chain settings
   - `bridge.signMessage` / `bridge.signPsbt` — route through `Approvals` unless the site already has the permission; approvals returns `{ approved, walletId, password, bip39Passphrase }` to complete the flow
   - `bridge.signAction` — Phase 1 supports `SEND` + `SWEEP`; other actions return `{ error: 'UNSUPPORTED_ACTION', supportedActions }` per §43.2 (structured, not thrown). `savePermanent: true` on the decision persists `canSignAction[KIND] = 'always'` on the ConnectedSite record
   - `bridge.signIn` — §43.6 challenge format `XChain Sign-In | appId | address | nonce | timestamp | expiresAt`, signed via the regular signMessageFlow. Default expiry 5 min, capped at 1 hour

**`Approvals` injection point** — shells inject an implementation that opens approval popups; `rejectAllApprovals` default throws `USER_APPROVAL_REQUIRED` so dApps get a structured error instead of a hang when the shell hasn't wired a popup yet. `UserRejectedError` class for explicit rejections.

**Manifest updates** — `content_scripts` matches `http://*/*` + `https://*/*` at `document_start`; `web_accessible_resources` exposes `inject/xchainProvider.js`; `permissions` adds `storage`.

Smoke-tested end-to-end through `MessageHost.handle()` (29 assertions): NOT_CONNECTED / MISSING_ORIGIN / CHAIN_NOT_PERMITTED / UNSUPPORTED_ACTION / USER_REJECTED / USER_APPROVAL_REQUIRED all surface as structured errors; connect → getAccounts → getAddresses → signMessage → signIn round-trip, signature verifies via SDK; disconnect removes the ConnectedSite; re-connect is idempotent.

## [0.29.0] - 2026-04-22

### Added

**§15.4 gap-limit address scan** — `discoverUsedAddresses(opts)`

Walks each chain's default HD derivation path from `startIndex`, asks the explorer "has this address been seen?", and stops after `gapLimit` consecutive unused addresses (BIP44 standard 20). Closes the "restore from seed" completeness gap: after an import the wallet knows the seed but not which addresses the user actually used — this flow discovers them.

Judgment calls (documented in the module header):

- **Partial-result semantics.** A chain's probe can fail mid-scan. The flow returns what was discovered up to the failure, marks `{ incomplete: true, error }`, and continues to the next chain. Callers resume by re-calling with `startIndex = lastScannedIndex + 1`
- **Unknown addresses preserve the gap.** When a single probe fails or times out, that index is recorded as `{ unknown: true }` — doesn't advance the gap counter, doesn't reset it either. Prevents a flaky response from masking a real used address (conservative; the chain-level timeout bounds the work if failures persist)
- **Two-tier timeouts.** `perQueryTimeoutMs` (default 5000) bounds one explorer call. `chainTimeoutMs` (default 60000) bounds the whole per-chain scan — a hanging or wildly-slow explorer can't lock the scan indefinitely
- **No persistence.** The flow returns a discovery report. Callers compose with `receiveAddress` or a review UI to persist what they want — same flow backs both "dry-run" and "real" restores
- **Address-type coverage.** Default scans only the descriptor's `defaultAddressType`. Opt in to every supported type via `addressTypes: 'all'`. Type-level failures (e.g. SDK doesn't support p2tr yet) mark that type as `incomplete` but other types on the same chain still scan — no whole-scan aborts from one unsupported type
- **Injectable used-check.** Default probe is `sdk.explorer.getHistory(address, 'address', { limit: 1 })` — empty array → unused. Callers can supply a bespoke `isUsedProbe` (e.g. `getBalances` + tx count) if the deployment's explorer exposes cheaper queries

Progress reporting: synchronous `onProgress(event)` — events `chain-start`, `scan-progress` (per-address, with `{ used, unknown, consecutiveUnused }` in `data`), `chain-complete`, `chain-failed`. Callback exceptions are isolated from the scan.

Smoke-tested: used addresses at {0, 3, 7} found with `highestUsedIndex=7` and exactly 13 queries at gapLimit=5; empty wallet terminates at gapLimit=20; multi-chain scan per-chain independent; mid-scan probe failures mark addresses unknown and record chain error without killing other chains; hanging probes bounded by `chainTimeoutMs`; resume via `startIndex=5` still finds index-7 used; `addressTypes: 'all'` scans every supported type; unsupported type in explicit list rejected; invalid mnemonic → `InvalidMnemonicError`.

## [0.28.0] - 2026-04-22

### Added

**§50 Diagnostic dump** — `diagnosticDump({ vault, chainRegistry, … })` + `createErrorRingBuffer({ capacity })`
- Collects the §50.1 JSON blob: wallet (version, platform, os, browser), sdk version, chain registry summary (id / coin / networkKind / user-added flag), endpoints per chain with custom-override flag, signer kinds + HW models, non-sensitive settings, recent errors (truncated), record counts (not records), build metadata
- Strict redaction via whitelist. Settings sanitization picks only known non-sensitive fields — future Settings additions default to being REDACTED unless added to the list (sensitive-by-default). ADS `accumulatedSats` and `lifetimeDonatedSats` redacted even though they're user-visible counters; `perTxAmountSats` / `triggerAmountSats` / `lifetimeTxCount` kept since they're useful for bug triage
- Every field the spec says to redact is absent: mnemonics, WIFs, passphrases, address strings, balance values, txids, contact names/addresses/notes, connected-site details. Counts only for wallets / accounts / addresses / contacts / connected_sites / pending_txs
- `createErrorRingBuffer({ capacity })` — fixed-size buffer for the shell's `window.onerror` / `unhandledrejection` / extension service-worker crash hooks (§50.4). Each entry: `{ at, kind, message (capped at 500 chars), phase? }`. Overflow drops oldest
- Dump is always producible — missing inputs become `null` rather than throwing, so even a half-configured wallet can emit a diagnostic
- Smoke-tested: empty-vault dump; full dump with wallet + imported WIF + contact (no secrets leak through `JSON.stringify`); user-custom endpoint override reflected; ring-buffer overflow and message-length truncation; dump round-trips through `JSON.stringify/parse` (no circular refs, no Uint8Array leaks)

## [0.27.0] - 2026-04-22

### Added

**§49 Offline / degraded mode** — reachability classification + queued broadcasts
- `checkReachability({ sdkRegistry, chainIds, probes?, timeoutMs? })` — per-chain × per-service (explorer / encoder / hub) probe with per-probe timeout. Returns `{ overall: 'normal'|'degraded'|'offline', perChain: [{ chainId, services, mode, latencyMs, errors }] }`. Default probes: `sdk.pingEncoder()`, `sdk.pingHub()`, and `sdk.explorer._get('/')` for explorer (any HTTP response within the timeout counts as reachable — probe only measures TCP+HTTP round-trip, not status code)
- Callers supply custom probes via `probes`; `null` disables that check and reports `'not-configured'` instead of reachable/unreachable. Cross-chain rollup: all-normal → `normal`, all-offline → `offline`, anything mixed → `degraded`
- New PendingTx status `'queued'` for §49.5 queued broadcasts
- `enqueueSignedTx` — stash signed tx hex in a PendingTx (fresh record or update an existing one). `listQueuedBroadcasts` — read all `status='queued'` records, optionally filtered by chainId. `drainQueuedBroadcast` — attempt to broadcast one; on success transition to `broadcast`, on failure stay `queued` with error recorded. `discardQueuedBroadcast` — user's "Discard" button (idempotent)
- Spec-compliant: §49.5 calls for per-record explicit user approval, not automatic re-broadcast — `drainQueuedBroadcast` is one-at-a-time and surfaces failure without swallowing. `discardQueuedBroadcast` is the dual
- Smoke-tested: normal/degraded/offline classification under all single- and multi-chain configurations, disabled-probe path, timeout path, end-to-end enqueue → drain success → drain failure → discard lifecycle, per-chain filtering

## [0.26.0] - 2026-04-22

### Added

**Signing from imported-WIF addresses** — unblocks spending from wif-only wallets and from imported-WIF addresses in HD wallets
- `SoftwareSigner.unlock` now decrypts every `Wallet.importedKeys` entry into `_unlocked.importedWifs` (Map<addressId, Uint8Array>). Same master-key lifetime as the seed — zeroed on `lock()` alongside it
- Abstract Signer contract updated: `SigningPathEntry` carries either `path` (HD, all signers) or `addressId` (imported-WIF, software signer only). Multi-key signing within one tx remains a future enhancement
- `SoftwareSigner.signPsbt` / `signMessage` / new `exportWifForAddressId` route by which field the entry carries. Exactly-one-of validation — supplying both or neither surfaces as a structured error at the signer boundary
- `normalizeSource` in `sendAsset` / `sweepAsset` now accepts Address records with `source='imported-wif'` and `derivationPath=null`; extracts the Address record's `id` as the `addressId` in the resulting signing-path entry. Watch-only and hardware sources still rejected with a clear message
- `signMessageFlow` accepts `{ path }` or `{ addressId }` (exactly one); `signPsbtFlow` passes the new `SigningPathEntry` shape through unchanged
- Smoke-tested end-to-end: HD+imported hybrid wallet signs via both paths (both signatures verify through `sdk.auth.verifyMessage`); wif-only wallet signs a message through the imported-key path; `normalizeSource` accepts imported-WIF records and still rejects watch-only; the signer's `exportWifForAddressId` returns the exact WIF that was imported

### Changed

- `Signer.SignMessageParams` now declares `path` and `addressId` as optional; exactly one must be present. HW-signer implementations should reject `addressId` at their own boundary (software-only concept)

## [0.25.0] - 2026-04-22

### Added

**ADS submission integration** (§36.3) — donation output injection + counter commit wired into `submitAction`
- New `ChainDescriptor.adsDonationAddress` field. All 9 bundled descriptors ship with the sentinel `'PLACEHOLDER_REPLACE_BEFORE_MAINNET'` (§5.5) — real addresses TBD closer to launch
- `ADS_DONATION_ADDRESS_PLACEHOLDER` + `isDonationAddressConfigured(descriptor)` exposed from the registry. A grep-replace sweep before mainnet release physically can't be missed — the sentinel is an obvious non-address string that fails any address validator
- `resolveAdsPlanForNextTx(settings, chainId, chainRegistry)` → `{ donationAmount, donationAddress, canSubmit, reason }`. Combines the pure arithmetic (`resolveAdsForNextTx`) with the address configuration check. `reason` enumerates `ok`, `ads-disabled`, `chain-not-seeded`, `trigger-not-reached`, `address-not-configured`, `unknown-chain` so UI can surface specific states (e.g. "pending donation $X — address not yet configured")
- `submitAction` now resolves the ADS plan up front and: (a) when `canSubmit`, appends `{ address, value }` to `encoderOpts.customOutputs` so the encoder builds the donation into the transaction; (b) after a successful broadcast calls `commitAdsStep` with `donationIncluded: canSubmit`. When ADS is enabled but `canSubmit=false` (placeholder still in place), the counter STILL advances with `donationIncluded=false` so the user's `lifetimeTxCount` reflects reality
- Caller-supplied `customOutputs` (e.g. for a COINPAY tx) survive alongside the ADS injection — the ADS output is appended, not replaced
- `commitAdsStep` failures are swallowed into an `ads-commit-failed` `onProgress` event rather than throwing; ADS accounting must not obscure a successful broadcast from the caller
- Smoke-tested: 9-descriptor sentinel sweep; all 6 resolver reasons; end-to-end inject path (real address) produces the expected customOutput + post-submit state (accumulator reset to perTx, `lifetimeDonatedSats` advanced); placeholder path produces NO injection but still advances `lifetimeTxCount` + `accumulatedSats`; caller's customOutputs preserved alongside ADS

### Known follow-up

Mainnet release checklist now has one concrete gate: `grep -r PLACEHOLDER_REPLACE_BEFORE_MAINNET packages/` must return empty before shipping. Regtest / testnet descriptors also carry the sentinel today; if e2e tests need the donation path exercised live, test harnesses should inject a custom descriptor via `ChainRegistry.addCustom`.

## [0.24.0] - 2026-04-22

### Added

**`importSingleWif(opts)`** (§15.4) — fresh wallet backed only by an imported WIF, no HD
- New `Wallet.format = 'wif-only'`. Schema carve-outs: `encryptedSeed` may be the empty string; `passphraseEnabled` must be false; `importedKeys` must have at least one entry (otherwise there's literally no key material and nothing to unlock)
- `SoftwareSigner.unlock` now branches on format: for `wif-only`, derives the master key from the password and probes it by decrypting the first `importedKey` entry. Wrong password surfaces the same way seed-decrypt failures do for seed-backed wallets (AEAD auth-tag mismatch)
- `exportPrivateKey` now branches its password-verification path by format: seed-backed wallets decrypt the seed blob as the probe; wif-only wallets decrypt the target `importedKey` directly (reused below for the actual WIF return). Either way a wrong password surfaces as `WrongPasswordError`
- Wallet + address + importedKey entry persisted atomically in order: wallet record (with the importedKey entry pre-populated) → address record. This keeps the wallet record schema-valid at the moment it hits the vault
- Smoke-tested: create → validate → unlock (right / wrong password) → export WIF → backup round-trip (the wif-only wallet survives `exportBackupFile` + `importBackupFile` and exportPrivateKey on the restored vault returns the same WIF)

### Known limitations

Spending from a wif-only wallet (and spending from imported-WIF addresses in an HD wallet) is still blocked on the separate signer gap: `SoftwareSigner.signPsbt` routes key lookup via HD path only. `sendAsset` / `sweepAsset` currently reject `source='imported-wif'` with a helpful error. The wif-only wallet can persist, unlock, receive, and export; spending lands when the signer routes through `importedKeys`.

## [0.23.0] - 2026-04-22

### Added

**XCW chunked PSBT-over-QR transport** (§20.3) — foundation for air-gapped signing
- Wire format: `XCW:<n>/<total>:<crc32-hex>:<base64-bytes>`. Per-chunk CRC32 in a separate textual field (not packed inside the base64) so a receiver sees a corrupted chunk before the payload parser
- Chunk content layout: chunk 1 carries `[32-byte SHA256 of reassembled bytes][payload part 1]`; chunks 2..N are raw payload parts. Hash on chunk 1 only (not every chunk) — putting the hash on every chunk would mean trusting the LATEST-scanned hash, exactly the wrong property
- `encodeXcwChunks(psbt, { chunkBytes })` — hex-or-Uint8Array input, default 180 bytes/chunk (~240 base64 chars; fits comfortably in an alphanumeric QR code)
- `decodeXcwChunks(frames)` — one-shot order-independent reassembly. `parseXcwChunk(frame)` — single-frame validation. `createXcwCollector` / `addChunkToCollector` — progressive scanner state for animated QR streams
- Order-independent reassembly, duplicate-chunk dedup (animated QR loops), CRC32 per-chunk integrity, overall SHA256 verification after reassembly. All four failure modes surface as structured `XcwChunkError` with specific messages (`crc32 mismatch on chunk N/M`, `SHA256 of reassembled PSBT does not match`, `chunk 1 too short`, `malformed frame`)
- `detectQrContent` now recognizes `xcw-chunk` frames and returns `{ type: 'xcw-chunk', n, total, content }` so scanner UIs can branch on the type before feeding into a collector. Matched BEFORE generic URI detection because `XCW:` with a BIP21 parser loosely applied would misclassify as scheme `xcw`
- Smoke-tested: tiny-PSBT-single-chunk, 1KB-PSBT-13-chunks round-trip; out-of-order reassembly; duplicates silently ignored; CRC flip caught mid-stream; hash-mismatch caught when a chunk is forged with a valid CRC but different content

## [0.22.0] - 2026-04-22

### Added

**Labels-survive-restore: on-chain FILE-action sync** (§19.5.2) — seed-derived encrypted labels + contacts
- `computeLabelSyncCommitmentKey(seed)` → `SHA256("xchain-wallet-label-sync" || seed)` — deterministic 32-byte AES-256 key; same seed always produces the same key
- `computeLabelSyncDiscoveryName(commitmentKey)` → hex SHA256 of the key — goes into the FILE action's `name` field so a restoring wallet can find its own ciphertext without trial-decrypting every FILE on the chain
- `encodeLabelSyncPayload` / `decodeLabelSyncPayload` — AES-256-GCM `iv || ct || tag` round-trip; body shape `{ version, updatedAt, labels, contacts }`
- `buildLabelSyncPayload({ vault, walletId, seed })` — reads the wallet's labeled addresses (HD + imported-WIF, label must be non-empty) and contacts; returns `{ ciphertext, discoveryName, body }` ready for the caller to publish via a FILE action
- `applyLabelSyncPayload({ vault, walletId, payload, onConflict })` — matches incoming labels to persisted addresses by id first, by `address` string as fallback (the id can't survive a from-seed restore because the new wallet generates fresh UUIDs). `onConflict: 'overwrite'` (default, user asked for sync) or `'preserve'`. Contacts are fully upserted with a fresh `updatedAt`
- Returns `{ addressesUpdated, addressesSkipped, addressesMissing, contactsAdded, contactsUpdated, contactsSkipped }` so the shell can surface "restored N labels, Y incoming labels had no matching address"
- Smoke-tested: deterministic keys, round-trip decrypt, wrong-key rejection, end-to-end on a seed-restored wallet (labeled HD address on wallet A → new wallet B from same mnemonic → payload decrypts with B's seed → label applied to B's corresponding address)

The FILE action submission itself (calling `sdk.encoder.action` with the chain choice) is kept in the shell integration — it needs a chainId picker (lowest-fee chain by default per spec) and access to the wallet's fee strategy, both of which are orthogonal to the payload codec.

## [0.21.0] - 2026-04-22

### Added

**`dryRunRestore(opts)`** (§19.6) — test a backup without committing
- Derives the first N HD addresses per active chain from a caller-supplied mnemonic (+ optional BIP39 passphrase) and compares them against the current wallet's persisted addresses
- Format-aware (`bip39` vs `counterwallet-legacy`). Does NOT auto-detect — the same 12 words could be valid in both lists; a silent choice would mask a mismatch. Callers pick the format up-front, matching how the user entered their words
- Returns `{ overallMatch, perChain: [{ chainId, addressType, derived, comparisons, matchedCount, divergentCount, missingCount }] }` so the shell can render the per-chain green-check / red-X treatment from the spec
- `overallMatch = false` when any comparison diverges OR when the wallet has persisted addresses but none match (guards against "seed looks valid but isn't mine")
- Nothing persists. Seed material zeroed on exit; per-path HD keys zeroed inside the loop. `gapLimit` default 10, configurable 1–1000
- Smoke-tested: correct mnemonic matches, random BIP39 mnemonic diverges, `InvalidMnemonicError` for bad words, right/wrong BIP39 passphrase differentiate cleanly, `gapLimit` respected, address count unchanged after the flow runs

## [0.20.0] - 2026-04-22

### Added

**`exportBackupFile(opts)` / `importBackupFile(opts)`** (§19.4) — encrypted `.xchain-wallet` backup file
- Envelope per spec: `{ magic: 'XCHAIN-WALLET-BACKUP', formatVersion: 1, createdAt, walletName, encryption: { algorithm, kdf, iv, tag }, payload }`. iv/tag stored as separate base64 fields (not the vault codec's packed blob) so third-party implementations / auditors can inspect the envelope without matching our concatenation order
- Independent backup password per §19.4 — fresh Argon2id KDF params generated at export time (or caller-supplied via `kdfParams` override); the params land in the envelope so import reproduces the same master key
- Payload captures: wallet (incl. `encryptedSeed` + `importedKeys`), accounts scoped to the target walletId, addresses scoped via accountId or imported-key linkage, contacts + connectedSites (not wallet-scoped; ride whole), settings, pendingTxs for linked addresses, `signers: []` (reserved for HW pairings)
- Per-spec omissions: BIP39 passphrase (user re-enters on restore to preserve the passphrase's security property), hardware-wallet private keys (live on device)
- Import conflict policy `onConflict`: `'error'` (default, throws `BackupConflictError` with the conflict list), `'preserve'` (skip existing, write missing), `'overwrite'` (incoming wins). Returns `{ writes, skipped }` counts per collection
- Round-trip verified: labels survive, imported-WIF exports to the same string from the restored wallet, tampered payload bytes flip auth and reject, wrong magic / wrong password / wrong formatVersion all rejected with structured errors (`BackupFormatError`, `BackupPasswordError`)

**`@xchain-wallet/core/crypto/backup.js`** exposes the low-level primitives (`encodeBackupEnvelope`, `decodeBackupEnvelope`, `parseBackupEnvelope`, `stringifyBackupEnvelope`) for callers that want to wrap alternate payload shapes in the same envelope — e.g. the §19.5.2 label-sync commitment or a future diagnostic-dump envelope.

## [0.19.0] - 2026-04-22

### Added

**`exportPrivateKey(opts)`** (§17.7) — user-visible private-key export, parity with FreeWallet
- Routes by `Address.source`: HD addresses derive on-demand from the in-memory seed at the address's derivation path; `imported-wif` addresses decrypt the matching entry from `Wallet.importedKeys` under the wallet master key
- Refuses `trezor` / `ledger` with `NoKeyForAddressError({ reason: 'hardware' })` (key lives on device); refuses `watch-only` with `reason: 'watch-only'`
- Verifies password first by decrypting the seed blob — a wrong password returns `WrongPasswordError` on the imported-wif path instead of a vague AEAD failure
- Returns `{ wif, source, derivationPath, address, chainId }` for shell display. Memory hygiene: master key zeroed on exit, decrypted WIF-bytes zeroed after decoding. JS-string caveat from §17.7.3 still applies
- `SoftwareSigner.exportWifForPath({ chainId, path })` exposed as the HD path primitive; caller can use it directly during an already-unlocked session to avoid a second Argon2id round
- Smoke-tested end-to-end on real SDK: HD WIF round-trips to the same address via `sdk.wallet.importWIF` + `sdk.wallet.deriveAddress`; imported-WIF export returns the exact string that was imported; wrong password, missing address, watch-only, and hardware sources all reject with the right error class

## [0.18.0] - 2026-04-22

### Added

**ADS accumulator arithmetic** (§36.3) — pure + vault-aware helpers that drive the Automatic Donation System
- `resolveAdsForNextTx(settings, chainId) → { donationAmount }` — read-only check run BEFORE constructing a tx. If the accumulator has crossed the trigger, the next tx carries a donation output of that amount
- `stepAdsAccumulator(settings, chainId, { donationIncluded }) → Settings` — pure state transition run AFTER a successful broadcast. Normal: `accumulated += perTx`, `lifetimeTxCount++`. When `donationIncluded`: `lifetimeDonatedSats += prior accumulated`, `accumulated = perTx` (this tx's own contribution seeds the next cycle), `lifetimeTxCount++`
- `commitAdsStep({ vault, chainId, donationIncluded })` — vault-aware wrapper: reads current Settings, runs `stepAdsAccumulator`, persists
- Pure `step` is identity when ADS is disabled or the chain isn't seeded — safe to call unconditionally from submission flows
- Round-trip verified: 1000 txs at `perTx=1, trigger=1000` → exactly one donation fires on tx 1001; `accumulated` resets correctly; other chains' state is untouched

**Known gap:** the `submitAction` integration (inject donation output into `encoderOpts.customOutputs`, then `commitAdsStep`) is intentionally deferred. It needs a per-chain donation address, which is a §5.5 placeholder pending hub-config resolution. The arithmetic ships now; the integration lands when the address is wired.

## [0.17.0] - 2026-04-22

### Added

**`@xchain-wallet/core/uri`** — URI parsing + QR content detection

- `parseBip21Uri(uri)` / `encodeBip21Uri(opts)` (§29.10) — full BIP21 round-trip. Standard params (`amount`, `label`, `message`) lifted to the top level for convenience; anything else (including chain-specific `tick`, `action`, etc.) flows through `params`. `req-*` prefixed params surface in `required[]` so callers can enforce the BIP21 "must support" semantics. Percent-decoding at parse, percent-encoding at emit — round-trip verified through Unicode and special chars (`a&b=c d`, `Coffee ☕ / 50%`). `InvalidBip21Error` for malformed input
- `detectQrContent(input, { chainRegistry? })` (§32.2) — classifies a scanned string into one of: `bip21`, `xchain-uri`, `psbt-hex` (PSBT magic `70736274ff` prefix), `wif`, `mnemonic-bip39` (with whitespace + case normalization), `mnemonic-counterwallet`, `address` (loose heuristic fallback), or `unknown`. First-match-wins with specific formats tried before the loose address fallback. Chain-registry-aware: when a registry is supplied, BIP21 detection is restricted to its known `uriScheme`s (so `myscheme:addr` doesn't get misclassified as BIP21)

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
