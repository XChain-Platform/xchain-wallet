# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.58.0] - 2026-04-23

Phase 2 — Step 19 of 26 — piece 5d. Electron-builder packaging pipeline for the desktop shell (§40.12, §51). Closes Piece 5 (Electron desktop shell). Ships the scaffolding needed to produce installable artifacts on all three target OSes — electron-builder config, Vite renderer bundle, Dockerfile-based reproducible builds (Level-2 scoped to the pre-signing artifact), URI scheme registration (Tier-1 `xchain:` claimed unconditionally + Tier-2 `bitcoin/litecoin/dogecoin` registered at install, claimed only via runtime opt-in), deep-link dispatch with BIP21 parsing, electron-updater wiring against `downloads.xchain.io`, CSP tightening + hardened-runtime entitlements. Code signing is structured but env-var-driven — no certs in-repo; `pnpm run dist` works without signing for dev builds.

### Added

**Packaging config + build resources** (`packages/desktop/`)

- `electron-builder.config.cjs` — single source of truth for packaging across Windows / macOS / Linux.
  - `appId = io.xchain.wallet`, `productName = XChain Wallet`, `asar: true`, `npmRebuild: false`, `buildDependenciesFromSource: false` (reproducibility-critical flags).
  - `mac` — hardened-runtime + entitlements at `build/entitlements.mac.plist`, `identity: CSC_IDENTITY_NAME ?? null` (unsigned dev builds work without certs), notarization gated on `APPLE_API_KEY_ID`, targets: dmg + zip (x64 + arm64).
  - `win` — publisher = "Dankest, LLC", SHA256 signing, RFC 3161 timestamp server pinned (signatures survive cert expiry), targets: nsis + zip (x64 + arm64).
  - `linux` — maintainer + synopsis + description set, targets: AppImage + deb (x64 + arm64), xz compression on deb.
  - `protocols` declares all four schemes (`xchain`, `bitcoin`, `litecoin`, `dogecoin`) at install time so the OS knows we CAN handle them — runtime claim is gated in `main/protocol.js`.
  - `publish` — electron-updater generic provider at `https://downloads.xchain.io/wallet/desktop/`.
  - `extraMetadata.buildDate` derived from `SOURCE_DATE_EPOCH` (set by reproduce.sh to the HEAD commit's author date).
- `vite.config.js` — renderer build config. Deterministic chunk / asset filenames; source maps off; `assetsInlineLimit: 0` to prevent small-file inlining variance; output into `renderer/dist/`.
- `build/entitlements.mac.plist` — macOS hardened-runtime entitlements. `com.apple.security.device.usb` (required for WebHID ↔ Ledger), `com.apple.security.network.client` (xchain-sdk + Trezor Connect iframe + electron-updater); JIT / unsigned-executable disabled.
- `build/README.md` — placeholder for `icon.png` / `icon.icns` / `icon.ico` (not yet committed — icon design is an open task).
- `packages/desktop/package.json` — new scripts (`build:renderer`, `dist`, `dist:unpacked`, `reproduce`); new devDep `electron-builder ^25.1.0`; new dep `electron-updater ^6.3.0`.

**Level-2 reproducible builds** (§51)

- `Dockerfile` — digest-pinned Debian bookworm-slim base, SHA256-pinned Node 20.18.0 tarball, pnpm version sourced from root `packageManager` field via build-arg. Non-root `builder` user with UID 1000 (reproduce.sh maps to host UID via `--user`). Installs only the system deps electron-builder Linux target needs (fpm, fakeroot, rpm, libarchive-tools).
- `.dockerignore` — excludes `node_modules`, `dist`, `.vite`, etc. from the build context so the image stays small + doesn't leak local dev state.
- `scripts/build.sh` — in-container build entry. Enforces `SOURCE_DATE_EPOCH`, runs `pnpm install --frozen-lockfile`, builds the renderer, invokes `electron-builder --dir` (unpacked app only — signing happens outside), emits `/out/RELEASE_HASHES.txt` (sorted find | xargs sha256sum).
- `scripts/reproduce.sh` — third-party reproduction entry. Takes a git ref, derives `SOURCE_DATE_EPOCH` from its commit date, creates an isolated git worktree, builds the image with the ref's pnpm version, runs the build, prints the manifest for diffing against published `RELEASE_HASHES.md`.
- `REPRODUCIBLE_BUILDS.md` — end-to-end verification protocol: what's reproducible (Linux pre-signing artifact), what's NOT (signed outputs, macOS + Windows builds — those need platform-specific runners — the Electron framework download itself), the `diff` recipe, non-determinism sources we've addressed (SOURCE_DATE_EPOCH, LC_ALL / TZ, frozen lockfile, Vite deterministic hashing), update trust chain (platform-specific integrity checks), Trezor Connect trust boundary + on-device-confirmation mitigation, per-release checklist.

**URI scheme registration + deep-link dispatch** (`packages/desktop/main/protocol.js`)

- `TIER_1_SCHEME = 'xchain'` / `TIER_2_SCHEMES = ['bitcoin', 'litecoin', 'dogecoin']` — single source of truth.
- `registerProtocolClients(app, { optedInSchemes })` — claims `xchain:` unconditionally; Tier-2 schemes only when the caller passes them in the opt-in list. Proactively `removeAsDefaultProtocolClient`s un-opted schemes so the settings toggle can flip them later without a reinstall.
- `updateCoinSchemeOptIn(app, schemes)` — future settings-UI hook (persisted-preference wiring lands in a follow-up step).
- `attachDeepLinkHandlers(app, { onDeepLink })` — wires `requestSingleInstanceLock` (second `bitcoin://` click while app is running consolidates into the existing window), macOS `open-url`, Windows/Linux `second-instance` + first-launch `process.argv` scan. Returns `{ gotLock: false }` when another instance holds the lock, letting the caller quit cleanly.
- `classifyDeepLink(url)` — parses URIs. `xchain:` bubbles up raw (renderer decodes via core's action decoder). `bitcoin:` / `litecoin:` / `dogecoin:` run through core's `parseBip21Uri`; malformed BIP21 surfaces as `parsed: null` with raw preserved for debugging.

**electron-updater wiring** (`packages/desktop/main/updater.js`)

- `attachUpdater({ loader, onEvent })` — DI'd loader (dynamic-imports `electron-updater` in production). Short-circuits cleanly in dev (`isUpdaterActive() === false`) — no-op `checkForUpdates` + no event listener registration, so `pnpm run start` doesn't try to self-update against the prod URL.
- `autoDownload` forced off — user clicks "install" in an in-app notification, then `downloadUpdate()` runs and progress events relay to the renderer.
- All seven updater events (`checking`, `available`, `not-available`, `progress`, `downloaded`, `error`) forwarded via the `onEvent` callback in a uniform `{ type, info }` shape.

**Main-process wiring** (`packages/desktop/main/index.js`)

- Single-instance lock acquired BEFORE `whenReady` — per Electron's docs, `requestSingleInstanceLock` must fire early so a second invocation's URL routes into the existing instance before anything else runs.
- On `whenReady`: `registerProtocolClients(app, { optedInSchemes: [] })` (Tier-1 only until settings lands), `attachHidPermissions(session.defaultSession)` (unchanged from Step 18), `attachUpdater({ onEvent: relayToRenderer })` + kicks off a check.
- `forwardDeepLink` — queues the first URI if the renderer isn't up yet, replays on `ready-to-show`. Focuses the window so a `bitcoin://` click surfaces the app to the foreground.
- `mainWindow.loadFile` now points at `renderer/dist/index.html` (the Vite bundle output), not `renderer/index.html` (the source).

**CSP tightening** (`packages/desktop/renderer/index.html`)

- `frame-src https://connect.trezor.io` — explicit allowlist for the Trezor Connect iframe. Makes the trust dependency auditable instead of ambient permissiveness. `connect-src` stays `'self'` — the renderer itself never fetches from connect.trezor.io; only the Trezor iframe does, and it lives in a separate origin bound by `frame-src`.

### Smoke + docs

- `packages/core/test/desktop-packaging.smoke.js` — new. Exercises:
  - File layout + electron-builder config structure + deterministic flags (asar, npmRebuild, buildDependenciesFromSource).
  - All four schemes declared in `protocols`.
  - mac / win / linux target shapes; `identity: null` when CSC_IDENTITY_NAME unset; Windows RFC 3161 timestamp server pinned.
  - `publish` uses electron-updater generic provider pointing at `downloads.xchain.io` over HTTPS.
  - Protocol module: Tier 1 + Tier 2 constants; `registerProtocolClients` claims + removes correctly based on opt-in list; `classifyDeepLink` handles `xchain:`, coin URIs, malformed BIP21, junk input; `attachDeepLinkHandlers` validates its callback.
  - Updater module: dev-mode short-circuit, prod-mode event forwarding for all seven event types, `autoDownload` forced off, input validation.
  - `main/index.js` wires `registerProtocolClients` + `attachDeepLinkHandlers` + `attachUpdater` + single-instance lock + loads `renderer/dist/index.html`.
  - Dockerfile pins base-image digest + Node SHA256 + takes pnpm version as build-arg + runs as non-root.
  - `build.sh` / `reproduce.sh` — strict mode, `SOURCE_DATE_EPOCH` required, `--frozen-lockfile`, SHA256 manifest emission, `git worktree` isolation, `--user $(id -u):$(id -g)` mapping.
  - Scripts are executable.
  - CSP allowlists only `connect.trezor.io` for `frame-src`.
  - `REPRODUCIBLE_BUILDS.md` sections present.
- `packages/desktop/REPRODUCIBLE_BUILDS.md` — end-to-end verifier docs.

### Changed

- Version bump: `0.57.0 → 0.58.0`. All 8 workspace packages stay synchronized.
- `packages/desktop/package.json` description updated to reflect Piece 5 completion ("Phase 2 §40.12: main-process signing isolation, OS keychain auto-unlock, WebHID hardware signer pairing, electron-builder packaging with Level-2 reproducible pre-signing artifacts, URI scheme registration, electron-updater wiring").

### Known deferrals

- **Icon assets** — `build/icon.png` / `.icns` / `.ico` not yet committed. First public release must ship them; electron-builder's default placeholder is fine for dev.
- **Code-signing certs** — config structured, certs not wired. Signed releases happen when `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_API_KEY_ID` / `APPLE_TEAM_ID` are set in the build env. Needs Sectigo / DigiCert EV (Windows) + Apple Developer Program (macOS) before the first public signed release.
- **Tier-2 opt-in settings UI** — `updateCoinSchemeOptIn` exists; the settings screen + persisted preference backing it don't. A user-visible toggle for "Make XChain Wallet my default Bitcoin wallet?" lands alongside the settings route in a future step.
- **Trezor Connect local bundling** — deferred per the Step-19 risk analysis. On-device confirmation is the real trust anchor; CSP allowlist makes the CDN dependency auditable. Future step can bundle Connect assets under an `app://` scheme + flip `connectSrc` if a specific incident or product need justifies it.
- **macOS + Windows reproducible builds** — current Dockerfile targets Linux. Cross-compiling macOS / Windows bit-for-bit is significantly harder (platform runners, `lipo`, Authenticode signing, notarization tickets embedded in binaries). Pre-signing hashes for those platforms are published from maintainer-operated platform runners; VM-based reproduction is a post-1.0 consideration.
- **GPG-signed update manifests** — Linux artifact integrity today depends on HTTPS TLS + maintainer control of `downloads.xchain.io`. A TUF-style role separation model is a stronger chain we can add post-1.0.

### Developer notes

- Smoke count: 37 (was 36; +1 for desktop-packaging).
- End-to-end Electron + electron-builder execution still requires `pnpm install` (~200 MB Electron bundle) + platform-specific signing tooling. Static smokes cover the config + wiring; real `pnpm run dist` verification waits for a dev-env setup.
- Piece 5 (Electron desktop shell, §40.12) is feature-complete at this layer — Steps 16, 17, 18, 19 together deliver the scaffold, keychain auto-unlock, HW signer pairing, and packaging / update / URI scheme infrastructure. Phase 2 continues with Batch 2 (Steps 20-26 — BROADCAST, dispensers, DIVIDEND, AIRDROP, Advanced Actions Form, FreeWallet migration).

## [0.57.0] - 2026-04-23

Phase 2 — Step 18 of 26 — piece 5c. Hardware signer pairing goes live on the Electron desktop shell via Chromium's WebHID (`@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`) and Trezor Connect's iframe popup (`@trezor/connect-web`). Zero native modules — same pure-JS HW stack as the extension + web shells, so no `node-hid`, no `electron-rebuild`, no per-platform `.node` binaries, no `asarUnpack`. As part of this step the pair-sequence logic was hoisted into `@xchain-wallet/core/signerFactories/` so extension + web + desktop share one source of truth; shells own only the transport init + permission wiring.

### Added

**Core builders** (`packages/core/src/signerFactories/`)

- `signerFactories/trezor.js` — `makeTrezorFactory({ getConnect })`. Shell-agnostic Trezor pair sequence: call `getConnect()` to obtain an initialized TrezorConnect, call `getFeatures`, derive `deviceIdentifier` / `model` / `firmwareVersion` via the existing `deviceIdentifierFromFeatures` / `modelFromFeatures` / `firmwareVersionFromFeatures` helpers (from Step 13), construct a `TrezorSigner` with the connect reference, return `{ signer, pairingInfo }` for `flows.registerSigner`. No `@trezor/connect-web` imports in core — DI keeps the native SDK bound to each shell.
- `signerFactories/ledger.js` — `makeLedgerFactory({ getTransport, getAppClass })`. Shell-agnostic Ledger pair sequence: call the DI'd transport + Btc-class loaders, construct the Btc app, read `getAppAndVersion`, derive the device identifier from the account-0 xpub via `deriveLedgerDeviceIdentifier` (from Step 14), construct a `LedgerSigner`. Same DI posture as Trezor — no `@ledgerhq/*` imports in core.
- `signerFactories/index.js` — re-exports both builders.
- `packages/core/src/index.js` — re-exports `signerFactories` as a namespace bag alongside `signers`, `flows`, etc.
- `packages/core/package.json` — new `"./signerFactories"` subpath export for direct import without the root namespace.

**Desktop renderer factories** (`packages/desktop/renderer/signerFactories/`)

- `trezorFactory.js` — thin binding around `makeTrezorFactory`. Lazy-imports `@trezor/connect-web`, initializes with the XChain manifest, feeds the result into the core builder. Keeps the default `connectSrc` for now (pointing at `connect.trezor.io`); Step 19 packaging will add a local-bundled `connectSrc` so sign-click doesn't hit the network.
- `ledgerFactory.js` — thin binding around `makeLedgerFactory`. Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`, feeds `TransportWebHID.create()` + the Btc class into the core builder.

**Main-process WebHID permission wiring** (`packages/desktop/main/permissions.js`)

- `attachHidPermissions(session)` — attaches both `setPermissionRequestHandler` (grants `hid`, default-denies everything else) and `setDevicePermissionHandler` (allowlist: Ledger `0x2C97`, Trezor T `0x1209`, Trezor One `0x534C` — filters the device-picker dialog). Without this, Electron under `contextIsolation: true` + `sandbox: true` returns an empty device list to `navigator.hid.requestDevice()` and the WebHID transport spins indefinitely.
- `HID_VENDOR_ALLOWLIST` + `isAllowedHidVendor(vendorId)` — the constants + a pure helper so smokes can verify the allowlist without mounting an Electron session.
- `packages/desktop/main/index.js` — wires `attachHidPermissions(session.defaultSession)` into `app.whenReady`.

### Changed

**Shell factories — now thin bindings over core builders**

- `packages/extension/src/signers/trezorFactory.js` — rewritten to delegate pair logic to `makeTrezorFactory` while keeping the extension-specific manifest, lazy-loader, and cached Connect instance in place. Public API unchanged (`getTrezorConnect`, `pairTrezorSigner`, `resetTrezorConnect`). The `@trezor/connect-web` lazy-import stays in the extension package — core remains dep-free.
- `packages/extension/src/signers/ledgerFactory.js` — same posture: delegates to `makeLedgerFactory`, keeps `@ledgerhq/*` lazy-imports + cached transport in the extension.
- `packages/web/src/signers/trezorFactory.js` / `ledgerFactory.js` — unchanged. Web still re-exports from the extension factory via cross-package relative path, so it picks up the new delegation transitively.

**Renderer wiring** (`packages/desktop/renderer/App.jsx`)

- Imports `pairTrezorSigner` + `pairLedgerSigner` from the new `./signerFactories/*.js` modules and passes them into `PairSignerForm` (previously `undefined` placeholders per the Step 16 scaffold). The ActionsMenu entry description changed from "native HW transports arrive at Step 18" to "via WebHID + Trezor Connect".

### Dependencies

- `packages/desktop/package.json` — adds `@trezor/connect-web` ^9.7.0, `@ledgerhq/hw-transport-webhid` ^6.35.0, `@ledgerhq/hw-app-btc` ^10.21.0 at the same versions the extension pins. pnpm hoists to a single install so the on-disk footprint doesn't double. Description updated: "main-process signing isolation (§9.3.2) + OS keychain auto-unlock + WebHID hardware signer pairing (§40.12). electron-builder packaging ships in Phase 2 Step 19".

### Smoke + docs

- `packages/core/test/hw-factories.smoke.js` — new. Exercises:
  - Core builders exist + import no `@trezor/*` / `@ledgerhq/*` (comments stripped before the regex to let the JSDoc examples mention the SDK names without tripping the check).
  - `makeTrezorFactory` validates deps, success path returns `{ signer, pairingInfo }` with the right shape against a mock Connect, failure paths (user cancellation, malformed Connect) surface clear errors.
  - `makeLedgerFactory` same end-to-end: success path returns a `LedgerSigner` + pairingInfo with a deterministically-derived `deviceIdentifier`, failure paths (null transport, non-constructor Btc, Bitcoin app closed) surface clear errors.
  - Desktop renderer factories exist, import the core builder via cross-package relative path, and lazy-import the HW SDKs.
  - `packages/desktop/package.json` declares HW deps at extension-parity versions (drift guard: assertion diffs against extension/package.json).
  - `renderer/App.jsx` wires the real factories into PairSignerForm and no longer passes `undefined`.
  - Main-process permission handlers: vendor allowlist covers Ledger + both Trezor models; allows `hid` / denies other permissions; device handler filters on `deviceType === 'hid'` and whitelisted vendorId; rejects null session; invoked from main/index.js on `app.whenReady`.
- `packages/core/test/trezor-signer.smoke.js` — updated. New assertions verify the core builder file exists, exports `makeTrezorFactory`, and contains no `@trezor/connect-web` imports (real code, with comments stripped). Extension factory asserts it delegates via `makeTrezorFactory` + imports core through the cross-package relative path `../../../core/src/signerFactories/index.js`. Retains all Step-13 behavioural assertions (mock Connect round-trip, deviceIdentifier / model / firmwareVersion helpers).
- `packages/core/test/ledger-signer.smoke.js` — parallel updates for the Ledger factory migration.
- `packages/core/test/desktop-shell.smoke.js` — the Step 16 "renderer App passes `undefined` HW factories (deferred to Step 18)" assertion flipped to "renderer App wires real `pairTrezorSigner` + `pairLedgerSigner` factories". Description + success line updated accordingly.

### Known deferrals

- **Packaging** (Step 19) — electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51. Step 19 will also bundle Trezor Connect's iframe assets locally and flip the desktop factory's `connectSrc` to an `app://`-scheme URL so sign-click stops touching connect.trezor.io.
- **Sign-path integration for HW** — PSBT↔Trezor / PSBT↔Ledger converters + message-signing envelope + renderer↔background signing bridge remain deferred (see v0.53.0 CHANGELOG "Known deferrals"). Step 18 delivers pairing; actual HW signing lands in a dedicated later step.

### Developer notes

- Smoke count: 36 (was 35; +1 for hw-factories).
- Real-hardware verification still pending: plugging a Trezor + Ledger into the Electron app requires `pnpm install` + the ~200 MB Electron bundle + user manual testing. DI-mock smokes cover the wiring; live device exercise waits for Step 19 + on-device pass.
- `TrezorSigner` / `LedgerSigner` continue to have zero Trezor/Ledger SDK imports in core — the Step-13/14 invariant is preserved at the class level, and Step 18 extends it up to the factory layer.

## [0.56.0] - 2026-04-23

Phase 2 — Step 17 of 26 — piece 5b. OS keychain integration for the Electron desktop shell (§40.12). After the first-launch unlock, the master key is cached in the OS-level keychain (macOS Keychain / Windows DPAPI / Linux libsecret) via Electron `safeStorage` so subsequent app launches skip the password prompt until the user explicitly locks or the OS keychain becomes unreadable (logout, keychain reset, user profile change). When no real keychain is available, the shell silently refuses to persist to disk — the user re-enters their password every launch rather than have the key cached insecurely.

### Added

**Main process** (`packages/desktop/main/`)

- `main/keychain.js` — `KeychainSessionBackend` class. Same `{load, save, clear}` contract as the extension's `ChromeSessionBackend` so the shared pre-host handlers (`wallet.unlock`, `wallet.lock`, `wallet.create`, `wallet.import`) treat it identically. `save(masterKey)` encrypts via `safeStorage.encryptString`, writes the ciphertext to `session.bin` under `app.getPath('userData')` atomically (tmp + rename). `load()` decrypts the ciphertext, returning the raw key bytes; falls back to `null` on missing file, unavailable keychain, or decrypt failure (OS logout / keychain reset / corrupted ciphertext) — never throws on "no session", so callers treat `null` as "prompt for password". Also caches the current-session key in a module-private in-memory slot so the shell stays unlocked in-process even when no OS keychain is wired. `isAvailable()` returns false when `safeStorage.isEncryptionAvailable()` is false OR `getSelectedStorageBackend()` reports `basic_text` (deterministic fallback — no real confidentiality).
- `main/meta.js` — `FileMetaBackend` class. Plaintext JSON slot for the vault's Argon2id `kdfParams` (public by design; storing outside the ciphertext is the only way the unlock flow can derive the master key from the user's password before touching the encrypted blob). Atomic writes via tmp + rename.
- `main/runtime.js` — Electron-free state machine that `index.js` delegates to. `createRuntime(deps)` builds the lifecycle object; `ensureHost(runtime)` auto-unlocks from the cached session key; `tearDownHost(runtime)` closes the vault + drops the host; `handleIpcMessage(runtime, message)` routes pre-host types (gated by `PRE_HOST_MESSAGE_TYPES`) through `dispatchPreHost` and everything else into the `MessageHost`, returning the standard `{ ok, result } | { ok, error }` envelope. Non-pre-host messages when the host is null return `WalletLockedError`. The split keeps all the interesting logic testable under plain Node without importing `electron`.

**Extension + core refactor**

- `packages/extension/src/background/sessionMeta.js` — exported two new shell-agnostic helpers alongside the existing `attachSessionMetaListener`:
  - `dispatchPreHost(type, request, { storageBackend, sessionBackend, metaBackend, chainRegistry, sdkRegistry, onUnlocked, onLocked })` — the same handler dispatch the extension's chrome.runtime listener uses, now parameterized on the backend trio so desktop can wire a file/keychain backend set. Throws `Error` for unknown types.
  - `handleSessionStatus({ storageBackend, sessionBackend })` — refactored to take the backends as deps instead of instantiating `ChromeStorageBackend` / `ChromeSessionBackend` itself.
- `packages/extension/src/background/index.js` — re-exports `dispatchPreHost`, `handleSessionStatus`, and `PRE_HOST_MESSAGE_TYPES` alongside `attachSessionMetaListener`.

**Main-process rewire** (`packages/desktop/main/index.js`)

- Replaced the Step 16 scaffold's placeholder master-key wiring with the real three-backend pipeline. `app.whenReady` now:
  1. Builds the runtime against `FileStorageBackend` (vault) + `FileMetaBackend` (kdfParams) + `KeychainSessionBackend` (master key).
  2. Calls `ensureHost(runtime)` — best-effort auto-unlock. Success → vault opens, MessageHost comes up, renderer sees `state: 'unlocked'` on first `session.status`. Failure (no cached key, keychain unavailable, or cached key doesn't decrypt the vault — stale after a wallet reset) → stays locked; renderer drives `wallet.unlock` through the pre-host listener.
  3. Registers `ipcMain.handle(IPC_CHANNEL, …)` that delegates to `handleIpcMessage`.
- SDK factory swapped from the `getSdk / has / listChainIds` stub to a real `sdkLib.SDKRegistry` wrapping `createDevMockSdk` — same pattern the extension service worker and web hostBridge use, so onboarding flows actually reach the vault (the Step 16 stub didn't expose `.get(chainId)` and `wallet.create` would `TypeError`).
- `app.on('before-quit')` zeros the master key + closes the vault via `tearDownHost(runtime)`; the keychain ciphertext stays on disk so the next launch can auto-unlock.

### Smoke + docs

- `packages/core/test/desktop-keychain.smoke.js` — new, exercises the full Step 17 surface:
  - `KeychainSessionBackend` round-trip through a mock safeStorage (XOR scramble, not cryptographic — tests fidelity, not security). Ciphertext on disk is NOT equal to plaintext. `clear` removes the file + zeros the in-memory slot.
  - `isAvailable()` returns false when `isEncryptionAvailable()` is false; false when the backend is `basic_text`. `save` is a no-op (no file created) in the unavailable case but keeps the key in-memory for the current session.
  - `load()` returns `null` (not throws) on decrypt failure — simulates OS logout / keychain reset via a second backend instance with a failing `decryptString`.
  - `FileMetaBackend` round-trip: save + load preserves object shape, clear removes the file.
  - End-to-end runtime lifecycle with real crypto + mock keychain: fresh runtime → `state: 'no-wallet'` → `wallet.create` onboarding (onUnlocked fires, host is built, session.bin persisted, post-host `wallet.list` returns the created wallet) → "restart" (drop runtime, build a new one against the same userData) auto-unlocks via the keychain without a password prompt → `wallet.lock` clears session.bin + returns `WalletLockedError` for subsequent post-host messages → wrong-password `wallet.unlock` returns `InvalidPasswordError` with no session written → right password rebuilds the host + re-persists the session.
  - Keychain-unavailable path: onboarding succeeds but session.bin is NOT written; restart sees `state: 'locked'` and requires a password prompt. No insecure cache, as designed.
  - Static wiring: `main/index.js` imports `keychain.js`, `meta.js`, `runtime.js`; references `safeStorage` and `ensureHost(runtime)`; `runtime.js` routes via `dispatchPreHost` + gates on `PRE_HOST_MESSAGE_TYPES` + returns `WalletLockedError`; `keychain.js` checks `isEncryptionAvailable` + refuses `basic_text`.

### Changed

- `packages/desktop/package.json` description updated from "Native HW transports + OS keychain + packaging ship in Phase 2 Steps 17–19" to "main-process signing isolation (§9.3.2) + OS keychain auto-unlock (§40.12). Native HW transports + packaging ship in Phase 2 Steps 18–19".
- Version bump: `0.55.0 → 0.56.0`. All eight workspace packages stay synchronized per the convention codified at v0.54.0.

### Known deferrals

- **Native HW transports** (Step 18) — desktop-specific `pairTrezorSigner` + `pairLedgerSigner` factories using `@trezor/connect` (node) + `@ledgerhq/hw-transport-node-hid`. Until then PairSignerForm renders the "not available in this context" fallback on desktop.
- **Packaging** (Step 19) — electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51.
- **Idle-lock timer** — spec mentions an auto-lock on idle; desktop currently only locks on explicit `wallet.lock`. Folding an idle timer into `runtime.js` is cheap and can land in any later step.

### Developer notes

- Smoke count: 35 (was 34; +1 for desktop-keychain).
- The Step 17 scaffold is exercisable **only** via the smoke — actually launching Electron still needs `pnpm install` and the ~200 MB Electron bundle.
- `dispatchPreHost` is now the single source of truth for unlock / lock / onboarding dispatch. Extension's `attachSessionMetaListener` and desktop's `handleIpcMessage` both route through it — no divergence in error shapes, handler ordering, or validation between the two shells.

## [0.55.0] - 2026-04-23

Phase 2 — Step 16 of 26 — piece 5a. Opens **Piece 5 (Electron desktop shell, §40.12)** with the main-process signing isolation scaffold (§9.3.2). Desktop renderer mounts the same React app popup + web use; keys never cross the contextBridge IPC boundary into the renderer. Steps 17–19 fill in OS keychain, native HW transports, and electron-builder packaging.

### Added

**Main process** (`packages/desktop/main/`)

- `main/index.js` — Electron app entry. `app.whenReady` initializes the vault + MessageHost + BrowserWindow. `ipcMain.handle(IPC_CHANNEL)` routes bridge messages into the host. BrowserWindow is hardened: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `app.on('before-quit')` zeros the master key + closes the vault defensively.
- `main/messageHost.js` — `createDesktopMessageHost(deps)` wraps `createBackgroundHost` (the same factory the extension service worker uses) with an IPC-friendly `handle(message)` function. Exports `IPC_CHANNEL = 'xchain-wallet:message'` so preload + main never drift. Cross-package relative import keeps this smoke-resolvable under Node.
- `main/storage.js` — `FileStorageBackend` extends `StorageBackend`, persists the encrypted blob to `app.getPath('userData')/vault.bin`. Atomic writes via `fs.writeFile(tmpPath)` + `fs.rename()` — POSIX and Windows both guarantee atomic rename. `load()` returns `null` on ENOENT (first-run case). `vaultPathFor(userDataDir)` is a pure helper so non-Electron callers (smoke tests, CLI inspectors) can compute the path.

**Preload + renderer** (`packages/desktop/`)

- `preload.js` — exposes exactly `window.xchainWalletBridge.sendMessage(message)` via `contextBridge`, nothing else. No Node modules, no `require`, no filesystem access leak into the renderer.
- `renderer/main.jsx` — React mount. Imports `@xchain-wallet/core/ui/tokens.css` so design tokens install on `:root`.
- `renderer/App.jsx` — same state-machine shape as popup/web App.jsx: `MessagingProvider shell="desktop"` + every shared route under `@xchain-wallet/core/shared/routes/*`. PairSignerForm receives `pairTrezor={undefined}` + `pairLedger={undefined}` — the form's vendor cards render the "not available in this context" fallback. Real desktop-native HW factories arrive in Step 18.
- `renderer/bridgeMessaging.js` — wraps `window.xchainWalletBridge.sendMessage` into a `sendMessage(type, request)` Promise that mirrors `chromeMessaging.js`'s envelope unwrapping. Typed error names (`InvalidPasswordError`, `NotImplementedError`, etc.) preserve across IPC so shared components branch on them unchanged.
- `renderer/messaging.js` — popup/web-parity helpers (`unlockWallet`, `listWallets`, `getWalletBalances`, `sendAsset`, `issueToken`, `mintAsset`, `destroyAsset`, `registerSigner`, `listSigners`, `unregisterSigner`, `exportPrivateKey`, …). The smoke verifies that every helper the desktop exports exists in the popup module — drift in either direction would break the shared routes.
- `renderer/index.html` — standard Electron renderer HTML. Ships a CSP header (`default-src 'self'`) pinning the renderer to loading only locally-bundled assets.

**Smoke + docs**

- `packages/core/test/desktop-shell.smoke.js` — covers the main-process file layout, preload-bridge narrowness (no `node:` imports, no `require()`), IPC channel name constant, MessageHost reuse of `createBackgroundHost`, `contextIsolation` / `nodeIntegration` / `sandbox` on the BrowserWindow, full round-trip of the FileStorageBackend through an OS tmpdir, a real MessageHost `handle()` call (`wallet.list`) including the unknown-type error envelope, parity of the renderer messaging helpers against popup, App.jsx import surface + the `pairTrezor={undefined}` deferral, and synchronized-version diff against the root `package.json`.
- `packages/desktop/README.md` — rewritten from "Phase 2 — deferred" to document the Step 16 scaffold, the two-process architecture, and what Steps 17–19 still have to land.
- `packages/desktop/package.json` — declares `@xchain-wallet/core` + `@xchain-wallet/extension` workspace deps and Electron as a devDep (`^41.3.0`, the current stable at release time).

### Known deferrals

- **Unlock flow** — main/index.js initializes the vault with a placeholder master key. Real unlock (password → Argon2id → master key) comes via the existing `wallet.unlock` handler from `createBackgroundHost`; the vault's internal state needs a re-seed pass when the password is collected. This is fine for the scaffold — the IPC contract is in place, so Step 17's keychain work can extend it cleanly.
- **OS keychain** (Step 17) — Electron `safeStorage` wired to skip password prompts after first launch.
- **Native HW transports** (Step 18) — desktop-specific `pairTrezorSigner` + `pairLedgerSigner` factories using `@trezor/connect` (node) + `@ledgerhq/hw-transport-node-hid`. Until then PairSignerForm renders the "not available in this context" fallback on desktop.
- **Packaging** (Step 19) — electron-builder config, Authenticode / notarization / Linux repackage, URI scheme registration, reproducible-build scripts per §51.

### Changed

- Version bump: `0.54.0 → 0.55.0`. All eight workspace packages stay synchronized per the convention codified at v0.54.0.

### Developer notes

- Smoke count: 34 (was 33; +1 for desktop-shell).
- The Step 16 scaffold is exercisable **only** via the smoke — actually launching Electron needs `pnpm install` and the ~200 MB Electron bundle, which the dev environment here doesn't have. The smoke covers everything statically checkable + a real file-backed `FileStorageBackend` round-trip through the OS tmpdir.
- Using the extension's `createBackgroundHost` via cross-package relative path (matches `packages/web/src/hostBridge.js`'s convention) was the key call that keeps the MessageHost contract single-sourced without needing a pnpm workspace symlink at smoke time.

## [0.54.0] - 2026-04-23

Housekeeping — no feature changes. Drops the GitHub Actions CI workflow and synchronizes every workspace package's version with the root so all surfaces report the same version.

### Removed

- `.github/workflows/ci.yml` and the `.github/` directory. Matches the rest of the xchain-* platform (`xchain-encoder`, `xchain-decoder`, `xchain-node`, etc. don't ship a GitHub Actions workflow during their build phase). CI will be reintroduced post-Phase-2 when the wallet's release surface stabilizes. Until then: run the test suite locally with `node packages/core/test/_run-smokes.js` and Playwright with `pnpm --filter @xchain-wallet/e2e test`.
- `packages/core/test/e2e-harness.smoke.js` — section 5 (CI workflow structural checks) replaced with a comment explaining the removal. The smoke's OK-line updated to drop the "CI job" mention.
- `README.md` — the repo-tree line `├── .github/workflows/` removed.

### Changed

- **Synchronized versioning across all workspace packages.** Every `package.json` (root + `packages/core` + `packages/extension` + `packages/web` + `packages/desktop` + `packages/bridge-spec` + `packages/test-dapp` + `e2e`) now reports `0.54.0`. Previously sub-packages were pinned at `0.1.0` while the root tracked wallet progression — meaning a shipped extension bundle's manifest reported `0.1.0` instead of the true build version. The synchronized scheme lets users diff `0.54.0-extension` / `0.54.0-web` / `0.54.0-desktop` in each shell's About screen and confirm they're on the same codebase.
- `README.md` — new "Versioning" section documenting the lockstep-bump convention so it's discoverable.
- `e2e/README.md` — `## CI` section reworded to explain CI is intentionally absent during development, matching the xchain-* platform convention.
- `tools/build-reproduce/README.md` — Node-version pin note no longer points at the (now-removed) `.github/workflows/ci.yml`. Pin moves here until the release pipeline codifies it.

### Convention going forward

On each release, bump every `package.json` version in lockstep. The root `package.json` version is the single source of truth; every sub-package tracks it. Individual sub-packages do not maintain their own changelogs — this file is authoritative.

## [0.53.0] - 2026-04-23

Phase 2 — Steps 13–15 of 26 — pieces 4b + 4c + 4d. Closes out **Piece 4 (Hardware signers go live, §40.11 / §17.3–17.4 / §18)**. Trezor + Ledger signer classes, per-target transport factories (WebHID + Trezor Connect popup), the pairing UI, and the §17.7 view/export private key ceremony are all in. Device-signing itself — PSBT and message signing — is deliberately deferred; see "Known deferrals" below.

### Added

**Piece 4b / Step 13 — TrezorSigner (§17.3, §18.1)**

- `packages/core/src/signers/TrezorSigner.js` — `TrezorSigner` class extending `Signer`. Dependency-injected: constructor takes `{ id, displayName, model, deviceIdentifier, connect }`, where `connect` is the Trezor Connect instance. The class imports nothing from `@trezor/connect-web` — the DI keeps core decoupled from the SDK and makes mock-based testing clean. Implements `getStatus` (compares device_id to pairing-time deviceIdentifier), `getAddresses` (multi-index derivation with BIP44 purpose + coinType per chain), `getPublicKey`, and model/firmware-version/device-identifier extractors from `getFeatures` payloads.
- `signPsbt` + `signMessage` throw `NotImplementedError` with explicit deferral messages. PSBT↔Trezor input/output conversion depends on xchain-sdk's PSBT utilities; that integration gets its own step (see Known deferrals).
- `packages/extension/src/signers/trezorFactory.js` — extension (and popup) factory. Lazy-imports `@trezor/connect-web` so the SDK only loads when the user actually pairs; initializes Connect with the wallet's manifest; exposes `getTrezorConnect` + `pairTrezorSigner(opts)` + `resetTrezorConnect`. `pairTrezorSigner` returns `{ signer, pairingInfo }` — the caller persists `pairingInfo` via `flows.registerSigner`.
- `packages/web/src/signers/trezorFactory.js` — re-exports the extension factory via cross-package relative path, matching `hostBridge.js`'s convention so Node smoke tests resolve without the pnpm workspace symlink.
- `packages/extension/package.json` + `packages/web/package.json` — declare `@trezor/connect-web ^9.7.0` (pinned to the 9.x major, floor at 9.7 which is the current stable line).
- `flows.registerSigner` / `flows.listSignersForWallet` / `flows.unregisterSigner` wired into the background host as `signer.register` / `signer.list` / `signer.unregister` handlers. `messaging.registerSigner` / `listSigners` / `unregisterSigner` helpers exported from both popup + web — Step 15's pairing UI fires through these.
- New smoke: `packages/core/test/trezor-signer.smoke.js`. Hand-written ~30-line mock Connect exercises the class's `getStatus` / `getAddresses` / `getPublicKey` paths, proves same-device vs. different-device getStatus branching, asserts `signPsbt` + `signMessage` throw `NotImplementedError`, verifies the factory files + package.json deps, and proves the TrezorSigner class has zero Trezor SDK imports.

**Piece 4c / Step 14 — LedgerSigner (§17.4, §18.2)**

- `packages/core/src/signers/LedgerSigner.js` — same DI posture as TrezorSigner. Constructor takes `{ id, displayName, model, deviceIdentifier, app }` where `app` is the `@ledgerhq/hw-app-btc` Bitcoin app client. `getStatus(opts)` distinguishes Ledger's `'wrong-app'` state (user has a different coin app open) from `'disconnected'` / `'available'`. `getAddresses` derives per-chain formats (bech32 for BTC, legacy for DOGE/LTC). `deriveLedgerDeviceIdentifier(publicKeyHex)` fingerprints the account-0 xpub to produce a stable identifier (Ledger doesn't expose a serial — this is the common-wallet convention). `modelFromLedgerTransport` maps transport.deviceModel to firmware-manifest keys.
- `signPsbt` + `signMessage` deferred with the same `NotImplementedError` pattern as Trezor.
- `packages/extension/src/signers/ledgerFactory.js` — WebHID transport factory. Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`, opens a shared transport, constructs the Bitcoin app, reads `getAppAndVersion` + the identity xpub, derives the device identifier, returns `{ signer, pairingInfo }`.
- `packages/web/src/signers/ledgerFactory.js` — thin re-export (cross-package relative path).
- Both shell package.jsons declare `@ledgerhq/hw-transport-webhid ^6.35.0` + `@ledgerhq/hw-app-btc ^10.21.0`.
- New smoke: `packages/core/test/ledger-signer.smoke.js`. Mock app covers getStatus (wrong-app / available / disconnected), getAddresses across BTC / LTC / DOGE, deriveLedgerDeviceIdentifier determinism + input validation, modelFromLedgerTransport mapping, deferred signPsbt/signMessage, factory + package.json + zero-SDK-import checks.

**Piece 4d / Step 15 — Signer selection UI + view-key UI (§17.6, §17.7)**

- `packages/core/src/shared/routes/PairSignerForm.jsx` + `.module.css`. Four-stage flow: vendor picker (Trezor / Ledger) → pairing (shell-supplied factory runs) → confirm (device info + firmware verdict + label input) → saving (messaging.registerSigner) → done. The factories are injected as props (`pairTrezor`, `pairLedger`) so the shared route stays shell-agnostic. Firmware verdict (from `checkFirmware`) gates the save button: `'unsupported'` firmware changes the button to "Update firmware first" and disables save.
- `packages/core/src/shared/routes/ViewPrivateKey.jsx` + `.module.css`. Implements §17.7's reveal ceremony end-to-end:
    - Warning screen before any password prompt.
    - Password re-entry required every time, even when the wallet is already unlocked (§17.7.3).
    - Tap-to-reveal WIF; auto-hide on `window.blur`; Hide button always visible.
    - Clipboard auto-clear after 60 seconds.
    - `classifySource(address)` routes HW + watch-only addresses to informational panels (no password prompt, no fake reveal) per §17.7.2.
    - QR rendering via a `renderQR({ value })` render-prop so the `qrcode` dep stays in shell packages.
- `packages/core/src/flows/exportPrivateKey.js` — existed since Pass 2; this step wires it into the messaging surface. Background host registers `wallet.exportPrivateKey`; `messaging.exportPrivateKey(opts)` exported from both popup + web.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx` — new `'pair-signer'` sub-route; factories imported from each shell's `signers/*Factory.js` and passed into `<PairSignerForm>`. `buildActionEntries` grows a seventh "Pair hardware signer" entry in the Actions menu.
- New smoke: `packages/core/test/signer-ui.smoke.js`. Asserts four-stage state machine on PairSignerForm, DI prop shape + shell-agnostic imports, firmware-verdict gating, classifySource branching on ViewPrivateKey, window-blur + clipboard auto-clear wiring, exportPrivateKey handler + messaging, App.jsx sub-route + factory imports in both shells.

### Known deferrals

PSBT signing and message signing through hardware signers are deliberately unimplemented in Piece 4. Both `TrezorSigner.signPsbt` and `LedgerSigner.signPsbt` (and the corresponding `signMessage` methods) throw `NotImplementedError` with explicit messages. What they need:

- **PSBT↔Trezor conversion** — Trezor Connect's `signTransaction` takes its own input/output shape, not a raw PSBT. Converting requires xchain-sdk's PSBT utilities (input-value lookups, script-type inference, output formatting).
- **PSBT↔Ledger conversion** — Ledger's `createPaymentTransaction` has a similar per-input-and-output envelope. Same dependency profile.
- **Message signing envelopes** — both vendors return low-level `{ v, r, s }` or raw-signature shapes; the xchain-sdk convention for auth signatures needs a wrapping step.
- **Signing bridge** — HW signing physically runs in the renderer context (Trezor Connect popup needs a tab; Ledger WebHID needs a user gesture), but the rest of `submitAction` runs in the background service worker. The two halves need a messaging channel so the background can request a signature from the renderer-hosted signer. This is architectural work that likely wants its own step rather than being tacked onto a feature step.

These four items would cleanly compose into one step — "HW signing integration" — landing after Piece 5 (Electron desktop) since desktop has a much simpler signing-bridge story (main-process can hold the Transport directly, no renderer round-trip).

### Manual verification pending

End-to-end pairing against real hardware is not smoke-tested (no way to exercise WebHID / Trezor Connect popups from Node). Verification plan: plug in a Trezor + Ledger, run the popup extension + web app in a Chrome-family browser, walk through the `Actions → Pair hardware signer` flow for each vendor, confirm the SignerRecord persists with correct firmware + model + device identifier, and confirm firmware-verdict banners render correctly at current versus outdated firmware.

### Changed

- `packages/core/src/signers/index.js` — barrel now re-exports `TrezorSigner`, `deviceIdentifierFromFeatures`, `modelFromFeatures`, `firmwareVersionFromFeatures`, `LedgerSigner`, `deriveLedgerDeviceIdentifier`, `modelFromLedgerTransport` alongside the existing `SoftwareSigner` / `Signer` / firmware helpers.
- `packages/extension/src/background/createBackgroundHost.js` — new handlers: `signer.register`, `signer.list`, `signer.unregister`, `wallet.exportPrivateKey`.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` — new helpers: `registerSigner`, `listSigners`, `unregisterSigner`, `exportPrivateKey`.

### Developer notes

- Smoke count: 33. Both shell package.jsons declare the HW SDK deps but installation is not required for the smoke suite — the class-level tests use hand-written mocks; the factory-level tests are static (file existence + `package.json` checks).
- `TrezorSigner.getStatus` cross-checks the device's reported `device_id` against the `deviceIdentifier` captured at pairing time. Different device → `'disconnected'`. This is the "swapped device" defense — an attacker can't hand the user a substituted Trezor and expect the wallet to silently accept it.
- `LedgerSigner.getStatus({ chainId })` distinguishes the `'wrong-app'` state from `'disconnected'`. UI callers should treat `'wrong-app'` as a guided-prompt state ("Please open the Bitcoin app on your Ledger") rather than a hard error.
- The HW sign path is the biggest remaining pre-Phase-3 gap. Piece 5 (Electron desktop) comes next in the plan; a dedicated "HW sign integration" step should slot in either before or after Piece 5 depending on device-availability during testing.

## [0.52.0] - 2026-04-23

Phase 2 — Step 12 of 26 — piece 4a. Opens **Piece 4 (Hardware signers go live, §40.11 / §17.3–17.4 / §18)** with scaffolding only. No `@trezor/connect` or `@ledgerhq/hw-transport-*` dependencies yet — those land in Steps 13 (TrezorSigner) and 14 (LedgerSigner). This step is infrastructure Steps 13-14 plug into: persistent records for paired devices, a firmware status helper, and the cross-check UI the sign screens will render once HW signers come online.

### Added

- `packages/core/src/signers/firmware-manifest.js` — bundled manifest keyed by `vendor → model → { minimum, recommended, knownVulnerable[], unsupported[] }`. Ships with Trezor One / Model T / Safe 3 / Safe 5 and Ledger Nano S / Nano S+ / Nano X / Stax entries. JS module (not JSON) so browser shells and Node 18 both load it without loader config.
- `packages/core/src/signers/checkFirmware.js` — `checkFirmware({ vendor, model, version })` returns a flat verdict `{ status, vendor, model, displayName, minimum, recommended, updateUrl, detail, version }` where status is one of `'ok' | 'outdated' | 'vulnerable' | 'unsupported' | 'unknown'`. Version matching handles exact, prefix (`"1.11."`), and major-only (`"1.x"`) patterns. Also exports `compareVersions` for Steps 13-14 to reuse for ad-hoc comparisons. Unknown vendor/model falls back to `'unknown'` with a neutral "verify with vendor" banner rather than blocking the sign path.
- `packages/core/src/schemas/signer.js` — `SignerRecord` (v1) schema. Fields: `walletId`, `kind` (`'trezor' | 'ledger'`), `vendor`, `model`, opaque `deviceIdentifier`, `label`, `firmwareVersion` (nullable until first observation), `pairedAt`, `lastSeenAt`. No secrets (no PINs, seed material, or xpubs — those live on the device; the wallet re-derives public keys as needed). Re-exported from the `@xchain-wallet/core/schemas` barrel, with a migration slot wired up in `migrations.js`.
- Vault `signers` collection — added to `Vault.js`, the codec document shape, and the `emptyDocument`/`decodeDocument` fallbacks so older persisted blobs load cleanly with an empty `signers: []`.
- `packages/core/src/flows/registerSigner.js` — `registerSigner(opts)` is idempotent by `(walletId, vendor, deviceIdentifier)`: re-pairing the same physical device updates `firmwareVersion` + `lastSeenAt` + optional `label` rather than inserting a duplicate. `listSignersForWallet`, `unregisterSigner`, and `findSigner` round out the registry surface. Re-exported from `@xchain-wallet/core` flows.
- `packages/core/src/shared/components/DerivationPathCrossCheck.jsx` + `.module.css` — §18.5 UI block. Renders `{ signerName, path, address }` plus the wallet's explicit cross-check instruction: *"Verify the address shown on your device matches the address shown here. If they don't match, reject on the device."* Device-label branches on `signerKind` so copy reads "Trezor" / "Ledger" / fallback "your device" as appropriate. Ready to drop into sign screens — Steps 13-14 wire the render.
- New smoke: `packages/core/test/signer-scaffold.smoke.js`. Exercises the firmware verdicts (happy/outdated/unsupported/major-only/unknown vendor/unknown model/missing version/compareVersions edge cases), `SignerRecord` schema validation, `registerSigner` re-pair idempotence, a vault save→close→reopen round-trip (confirming codec slot persistence), and structural checks on the `DerivationPathCrossCheck` component.

### Changed

- `packages/core/src/signers/index.js` — barrel now re-exports `checkFirmware`, `compareVersions`, and `FIRMWARE_MANIFEST` alongside `Signer` + `SoftwareSigner`.
- `packages/core/src/schemas/migrations.js` — `signerMigrations` / `migrateSigner` registered; ready for future `SignerRecord` version bumps.
- `packages/core/src/storage/codec.js` — `VaultDocument` gains a `signers: SignerRecord[]` slot. Older blobs (no `signers` key) load with `[]` instead of `undefined`.

### Developer notes

- This step deliberately does **not** add any vendor SDK dependencies. `@trezor/connect-web`, `@trezor/connect` (node), `@ledgerhq/hw-transport-webhid`, and `@ledgerhq/hw-transport-node-hid` all land in Steps 13-14 where the `TrezorSigner` and `LedgerSigner` classes that consume them are built.
- `registerSigner`'s "idempotent by `(walletId, vendor, deviceIdentifier)`" contract is the reason Address records can keep a stable `signerId` across re-plug events: the user unplugging and replugging their Trezor should not cause the wallet to re-derive addresses or break the pre-existing `Address.signerId → SignerRecord.id` link.
- Smoke count: 30. vitest-setup smoke auto-updates the count.

## [0.51.0] - 2026-04-23

Phase 2 — Steps 8–11 of 26 — pieces 3a + 3b + 3c + 3d. Closes out **Piece 3 (standalone ISSUE / MINT / DESTROY + token admin surfaces, §40.2–§40.5)** end-to-end. Home now opens a new Actions menu that reaches six authoring surfaces: standalone ISSUE, MINT, DESTROY, Lock supply, Update description, Transfer ownership. Each form reviews its draft through the shared action decoder (same preview the dApp-initiated sign screen uses) and signs through a background handler backed by a core flow.

### Added

**Piece 3a / Step 8 — standalone ISSUE (§40.2)**

- `packages/core/src/shared/routes/IssueTokenForm.jsx` + `.module.css` — two-stage authoring surface (form → review/submitting → done) mirroring `Send.jsx`. Every ISSUE v0 field the wizard's Custom composer exposes is available on a single screen: ticker, supply, divisible, description, lock supply + minting, transfer ownership. Review step runs `decoder.decodeAction({ action: 'ISSUE', params })` so the plain-English summary matches the sign screen shown for dApp-initiated ISSUE. Sign uses the existing `messaging.issueToken` helper from v0.50.0 — no new flow or background handler needed.
- `packages/core/src/shared/routes/ActionsMenu.jsx` + `.module.css` — secondary surface listing §40.2+ authoring forms. Entries are passed in as a prop so each shell controls which actions appear; one screen today, gains entries as Piece 3 progresses.
- `packages/core/src/shared/routes/Home.jsx` — accepts a new `onActions` prop and renders a fourth "More actions" button below the Send / Receive / Create-a-token row.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx` — new `'actions'` and `'issue'` sub-routes; a shared `buildActionEntries` helper in each shell wires each entry's `onSelect` back to `setUnlockedView`.
- New smoke: `packages/core/test/issue-form.smoke.js` — exercises the two-stage state machine, ticker validation (A-Z/0-9), positive-supply validation, ISSUE v0 composer (MAX_SUPPLY + MINT_SUPPLY from supply, DECIMALS 8/0 from divisible, LOCK_MAX_SUPPLY + LOCK_MINT on lock, TRANSFER on transferTo), decoder wiring, messaging.issueToken call-site, ActionsMenu surface, Home onActions wiring, both App.jsx sub-routes.

**Piece 3b / Step 9 — MINT form (§40.3)**

- `packages/core/src/flows/mintAsset.js` — wraps `submitAction` with `action: 'MINT'`. Guard-rails reject missing opts / params / TICK / AMOUNT / from. Re-exported from `@xchain-wallet/core` flows.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.mint`, forwarding to `mintAsset` with vault + registries injected.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` — each exports `mintAsset(opts)` routing to `action.mint`.
- `packages/core/src/shared/routes/MintForm.jsx` — two-stage form (ticker + amount + optional destination) reusing `IssueTokenForm.module.css`. Ticker allows a period so subassets (`PARENT.CHILD`) can be minted. Empty DESTINATION renders in the preview as "broadcasting address" — matches protocol §MINT semantics. Wired into the Actions menu as "Mint" and into both `App.jsx` sub-routes.
- New smoke: `packages/core/test/mint-form.smoke.js` — exercises the flow's guard-rails live, verifies the decoder wiring + messaging.mintAsset call-site + action.mint handler + both messaging helpers + ActionsMenu entry + popup/web sub-route wiring.

**Piece 3c / Step 10 — DESTROY form (§40.4)**

- `packages/core/src/flows/destroyAsset.js` — `submitAction` wrapper with `action: 'DESTROY'` and the same guard-rail shape as `mintAsset`.
- `packages/extension/src/background/createBackgroundHost.js` — registers `action.destroy`.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` — each exports `destroyAsset(opts)` routing to `action.destroy`.
- `packages/core/src/shared/routes/DestroyForm.jsx` — two-stage form (ticker + amount) with an explicit "Destroy is irreversible" warning rendered on the form stage (before composing, not just on review). Sign button uses the `danger` Button variant to visually reinforce the intent. Decoder smoke case 2h already covers the decoder's irreversibility warning; the form renders it prominently on review.
- New smoke: `packages/core/test/destroy-form.smoke.js` — verifies irreversibility prose, danger variant, flow guard-rails, action.destroy handler, messaging helpers, ActionsMenu entry, and popup/web sub-routes.

**Piece 3d / Step 11 — token admin (§40.5)**

- `packages/core/src/shared/routes/TokenAdminForm.jsx` — single parameterized component driven by a `mode` prop (`'lock'` | `'description'` | `'transfer'`) delivering the three §40.5 surfaces:
    - **Lock supply** — ISSUE v3 with `LOCK_MAX_SUPPLY` + `LOCK_MINT`. Renders a "Locking is permanent" warning on the form stage and uses the `danger` Button variant on the sign button.
    - **Update description** — ISSUE v1 with a single `DESCRIPTION` field. Replaces the existing on-chain description.
    - **Transfer ownership** — ISSUE v0 with only `TRANSFER` set. New owner address required.

  All three reuse `messaging.issueToken` — no new background handler or core flow needed, since every admin action is ISSUE at the protocol level.
- `packages/extension/src/popup/App.jsx` + `packages/web/src/App.jsx` — three new sub-routes (`'lock'`, `'description'`, `'transfer'`), all rendering `<TokenAdminForm mode={unlockedView} …/>`. `buildActionEntries` grows three more entries so the Actions menu surfaces all six of Piece 3.
- New smoke: `packages/core/test/token-admin-form.smoke.js` — exercises the mode-driven composer (v3 + lock flags / v1 + DESCRIPTION / v0 + TRANSFER), lock-only permanence warning, danger-variant on lock sign, decoder wiring, messaging.issueToken reuse, and all three sub-routes in both shells.

### Changed

- `packages/core/src/shared/routes/Home.jsx` now exposes a fourth "More actions" button in addition to Send / Receive / Create-a-token, gated on `onActions`. Popup + web shells pass `onActions` when an `activeWalletId` is present.
- `packages/core/src/flows/index.js` re-exports the two new flows: `mintAsset` and `destroyAsset`.
- `packages/extension/src/background/createBackgroundHost.js` handler surface grows two entries: `action.mint` and `action.destroy`.

### Developer notes

- Across Piece 3, each form mirrors `Send.jsx`'s two-stage shape (form → review/submitting → done) rather than the wizard's five-stage shape — standalone forms don't need a template picker or chain picker screen. Chain picker is inline at the top when the wallet has addresses on more than one chain.
- The Custom wizard template and the standalone ISSUE form are deliberately redundant surfaces: the wizard is the guided entry point; the standalone form is the escape hatch for power users (and eventually the Token detail page, which will link into it for specific tokens).
- Admin modes pick ISSUE protocol versions based on what yields the cleanest decoded summary (see `action-decoder.smoke.js` cases 2b–2d). A pure lock uses v3, a pure description update uses v1, a pure transfer uses v0.
- MintForm + DestroyForm accept tickers with a period so subasset mints / destroys work; the top-level wizard validator rejects periods because it joins `PARENT.CHILD` itself.
- Smoke count: 29. vitest-setup smoke reports the new count; no existing smokes regressed.

## [0.50.0] - 2026-04-23

Phase 2 — Steps 5-7 of 26 — pieces 2c + 2d + 2e. Closes out **Piece 2 (Token Creation Wizard, §40.1)** end-to-end. The wizard is now reachable from Home on both popup + web, all six templates are interactive with per-template field visibility + composition, and the sign stage runs through a real `action.issue` background handler backed by a new `issueToken` core flow. First Phase-2 user-visible feature shipped.

### Added

**Piece 2c / Step 5 — messaging + background host** (§40.1 sign stage)

- `packages/core/src/flows/issueToken.js` — wraps `submitAction` with `action: 'ISSUE'`, reuses `normalizeSource` from `sendAsset`, forwards encoder + signer options through. Guard-rails reject missing opts / params / TICK / from before hitting the SDK.
- `packages/core/src/flows/index.js` re-exports `issueToken`.
- `packages/extension/src/background/createBackgroundHost.js` registers `action.issue` next to `action.send` + `action.sweep`. Handler injects `vault`, `chainRegistry`, `sdkRegistry` from the host context; the popup + web payloads are pass-throughs.
- `packages/extension/src/popup/messaging.js` + `packages/web/src/messaging.js` each export `issueToken(opts)` — same signature, same target message type, matching the popup/web parity pattern the other helpers follow.
- New smoke: `packages/core/test/issue-token.smoke.js`. Exercises the flow's guard-rails live (`flows.issueToken` throws on missing opts / params / TICK / from) and statically verifies the `action.issue` handler + both messaging helpers + the wizard's call-site.

**Piece 2d / Step 6 — per-template composition**

- `TEMPLATE_COMPOSERS` object in `TokenWizard.jsx` replaces the single `composeIssueParams` function. One composer per template (Meme / Utility / Community / Collectible / Subasset / Custom), each picking the subset of ISSUE v0 fields that template wants:
    - **Meme** — one ISSUE with `MAX_SUPPLY` + `MINT_SUPPLY` (creator gets full supply) + `DECIMALS=0` + `LOCK_MAX_SUPPLY` + `LOCK_MINT`. Matches §40.1's intent atomically via a single transaction; the spec's "BATCH" description was inaccurate — the protocol's ISSUE v0 composes mint + lock in one go.
    - **Utility** — `MAX_SUPPLY` + `MINT_SUPPLY` + optional `MAX_MINT`, no lock flags. Mintable going forward.
    - **Community** — same shape as Utility. Dividends happen later via the DIVIDEND action on the TICK; no Phase-1 flag on ISSUE.
    - **Collectible** — single-edition (`MAX_SUPPLY=1`, `MINT_SUPPLY=1`, `DECIMALS=0`, both locks). Image goes in `DESCRIPTION` — explorer renders linked URLs as images (the JDOG protocol example). Full FILE + BATCH path is deferred past Phase 2 because §BATCH bans FILE.
    - **Subasset** — composer joins `parent.child` into the final `TICK`; form collects parent + child separately so the wizard can show the preview correctly.
    - **Custom** — every ISSUE v0 field exposed (superset of the other five). The escape hatch for edge cases the templates don't cover.
- `TEMPLATE_FIELDS` visibility map drives which inputs show on the details stage per template. Collectible hides Supply (hard-wired to 1 by composer). Subasset adds Parent asset (required, uppercased, A-Z 0-9). Community hides the lock-on-create + transfer-to toggles (Utility's shape).
- `TEMPLATES` table: all six `interactive: true`. The "Coming in Step 6" affordance is gone — templates are live.
- New form state: `imageUrl` (Collectible), `parentAsset` (Subasset). Both stay in state across template switches so the user can flip templates without retyping.
- Details-stage validation tightened: top-level ticker is `[A-Za-z0-9]+` (no period — the composer joins for subassets). Subasset requires `parentAsset`. Collectible skips the positive-supply check (composer pins supply to 1).

**Piece 2e / Step 7 — Home entry + App.jsx routing**

- `packages/core/src/shared/routes/Home.jsx` accepts a new `onCreateToken` prop and renders a third "Create a token" action card next to Send + Receive.
- Popup + web `App.jsx` both add `'wizard'` to the `unlockedView` sub-route union; `<TokenWizard walletId onBack>` renders when `unlockedView === 'wizard'`; Home receives `onCreateToken` bound to the sub-route setter. Identical wiring on both shells — same pattern as Send + Receive, which is why the shared-routes refactor (Piece 1) was worth doing first.
- `packages/core/test/shared-routes.smoke.js` grows its file-existence list + App.jsx import list to include `TokenWizard`, and adds `routeMessagingCalls.TokenWizard = ['messaging.getAddressesByChain', 'messaging.issueToken']` so the wizard gets the same call-site + context-use assertions the other routes get.
- `packages/core/test/token-wizard.smoke.js` adds a Section 9 covering the Home + App.jsx wiring (`onClick={onCreateToken}`, `'wizard'` sub-route in both shells, `<TokenWizard>` rendered).

### Wiring diagram (end-to-end for §40.1)

```
Home → onClick={onCreateToken} → App.jsx setUnlockedView('wizard')
     → <TokenWizard walletId onBack>
        → stage: template → chain → details → preview → sign
        → composeIssueParams(template, form)  [per-template composers]
        → decoder.decodeAction({ action: 'ISSUE', params })  [Step 3]
        → messaging.issueToken({ walletId, password, chainId, from, params })
        → chrome.runtime.sendMessage / hostBridge.sendMessage → 'action.issue'
        → createBackgroundHost → issueToken flow
        → submitAction → SDK encode + sign + broadcast
        → { txid } → TokenWizard.stage = 'done'
```

### Tests

- 25 smokes pass (`node packages/core/test/_run-smokes.js`) — `issue-token.smoke.js` added, `shared-routes.smoke.js` + `token-wizard.smoke.js` extended.
- Static-wiring assertions cover every link in the diagram above except the SDK broadcast (needs real `xchain-sdk` install + regtest, gated to the reproducible-build pipeline).

### Scope boundary

- **Collectible's FILE path is deferred.** The shortcut of putting the image URL into `DESCRIPTION` matches the protocol's JDOG example; it relies on the explorer/indexer recognizing URLs and rendering them. Full FILE-action support (IPFS-style content IDs, BATCH composition) is a Phase-3 or later feature because protocol §BATCH explicitly bans FILE inside a BATCH and the FILE-action pipeline is its own product surface.
- **Subasset parent-ownership is not verified pre-flight.** The wizard accepts any `parentAsset` string; the protocol layer rejects a subasset-create on a parent the signer doesn't own. A future polish queries the wallet's owned-assets index + presents a picker.
- **Auto-lock still popup-only.** The wizard inherits the shell-level auto-lock behavior from the shared-routes infrastructure.
- **Fee estimation is pass-through.** `issueToken` forwards `fee` / `feePerKb` / `rbf` options to `submitAction` but the wizard UI doesn't expose them — creators get the SDK default. Explicit fee control lands with RBF (Pass 5 §44.4) or the Advanced Actions Form (§40.10).

## [0.49.0] - 2026-04-23

Phase 2 — Step 4 of 26 — piece 2b. Token Creation Wizard scaffold (§40.1). Five-stage flow (template → chain → details → preview → sign) rendered from `@xchain-wallet/core/shared/routes/TokenWizard.jsx` so popup + web + eventual desktop shells all consume the same component via `MessagingProvider`.

### Added

**`packages/core/src/shared/routes/TokenWizard.jsx` + `TokenWizard.module.css`**

- **Template stage** — a 6-card picker (Meme / Utility / Collectible / Community / Subasset / Custom) matching §40.1. **Custom** is the only interactive template today; the other five surface a "Coming in Step 6 — use Custom for now" affordance and visually disable themselves. Dedicated per-template detail forms + composition (Meme = one ISSUE with lock flags, Collectible = FILE+ISSUE+MINT BATCH, Subasset = `PARENT.SUB` ticker, etc.) land in Step 6 (piece 2d).
- **Chain stage** — filters to chains the wallet already has a persisted address on (the wizard needs a fee-paying address; "create on a new chain" goes through Receive first). Auto-picks the highest external HD address. Matches Send.jsx's chain-picker pattern.
- **Details stage (Custom)** — every ISSUE v0 field exposed: ticker (A–Z 0–9 + period, auto-uppercased on input), display name (UI-only, not stored on-chain), supply, divisible toggle (→ `DECIMALS = 8 | 0`), description (on-chain, 250 char cap), max-mint-per-tx, lock-on-create toggle (sets both `LOCK_MAX_SUPPLY` + `LOCK_MINT`), transfer-ownership address.
- **Preview stage** — runs the composed ISSUE params through the Step 3 decoder (`decoder.decodeAction({ action: 'ISSUE', params, chainId, chainRegistry })`) so the user sees the plain-English recap + warnings (permanent-lock, empty-ticker, etc.) before entering the password. Password field follows the Send review pattern.
- **Sign stage** — calls `messaging.issueToken({ walletId, password, chainId, from, params })`. The messaging helper + background `action.issue` handler land in Step 5 (piece 2c); the sign button surfaces the "unknown message type" error cleanly until then. `InvalidPasswordError` maps to "Incorrect password." inline; other errors show the raw message.
- **Done stage** — renders transaction id if present.

**`composeIssueParams()`** — file-local helper, not exported. Maps the form state into the ACTION params shape the SDK + decoder both consume. Uppercases the ticker (belt-and-suspenders with the `<Input onChange>`), sets `MINT_SUPPLY = supply` on create so initial supply lands in the creator's wallet, expands the lock-on-create toggle into both `LOCK_MAX_SUPPLY` and `LOCK_MINT`. Step 6 will wrap per-template composers around this base.

### Tests

- `packages/core/test/token-wizard.smoke.js` (8 assertion groups). Covers: file existence, `TokenWizard` export, composer kept file-local, all five stages + done present, each stage-transition `setStage('next')` call-site, TEMPLATES table has all six with Custom alone interactive, preview calls `decoder.decodeAction({ action: 'ISSUE', ... })`, sign stage calls `messaging.issueToken`, ticker upper-casing, `DECIMALS` 8/0 mapping, `LOCK_MAX_SUPPLY` + `LOCK_MINT` wiring, `TRANSFER` field, `useMessaging` + `screenVariantFor` context use, CSS module class presence.
- 24 smokes pass; the new test lands at `token-wizard.smoke.js` and auto-discovers via `_run-smokes.js`.

### Not wired yet

- **No Home entry + no App.jsx route.** The wizard is file-only; Home's "Create a token" card and the popup + web `unlockedView` transition land in Step 7 (piece 2e). A user running today's build can't reach the wizard through the UI — the route is ready, the entry is in the next sub-piece.
- **Sign stage is stubbed end-to-end.** `messaging.issueToken` lands in Step 5 (piece 2c) along with the `action.issue` background handler + a core `flows/issueToken.js` SDK wrapper.
- **Five templates are non-interactive.** Per-template details forms + BATCH composition (Collectible) + subasset parent-picker land in Step 6 (piece 2d).

## [0.48.0] - 2026-04-23

Phase 2 — Step 3 of 26 — piece 2a. Extends `actionDecoder.decodeAction` to cover the four ACTION kinds the Token Creation Wizard (§40.1) emits: ISSUE (all six format versions), MINT, DESTROY, BATCH. Unlocks the wizard's preview step in the next sub-piece so the user sees a plain-English recap of what they're signing before the key material is touched.

### Added

**`packages/core/src/decoder/actionDecoder.js`**

- **ISSUE** — six format-version branches. Summaries differentiate the semantic intent rather than just echoing "ISSUE":
    - v0 with `MAX_SUPPLY` → `"Create token TICK with max supply N on Chain"`.
    - v0 with `TRANSFER` but no supply fields → `"Transfer ownership of TICK to ADDR on Chain"`.
    - v0 otherwise → `"Configure token TICK on Chain"`.
    - v1 → `"Update description of TICK on Chain"`.
    - v2 → `"Update mint parameters of TICK on Chain"`.
    - v3 → `"Lock TICK (max supply, minting, ...) on Chain"` when any `LOCK_*` flag is set; names the locks in human terms, not field names.
    - v4 → `"Update callback parameters of TICK on Chain"`.
    - v5 → `"Update allow/block list for TICK on Chain"`.
- **MINT** — `"Mint AMOUNT TICK on Chain to DESTINATION"`; missing destination reads as `"broadcasting address"` in the details list.
- **DESTROY** — v0 (single) produces `"Destroy AMOUNT TICK on Chain"`. v1/v2 (multi-destroy, repeating `TICK`/`AMOUNT` pairs) fall through to the generic decoder but are decorated with the irreversibility warning so the user still sees it before signing.
- **BATCH** — recurses into the `params.COMMANDS` array (wallet-side shape; each entry `{ action, params }`) and composes child summaries into a numbered list. Details show `Step N` rows with indented sub-action details. Warnings from every nested command bubble up to the root. Empty / malformed `COMMANDS` surfaces a dedicated "review raw transaction" warning so no blind-sign is possible.

**New warnings across the four kinds**

- `"Locking is permanent — these properties cannot be changed after this transaction confirms."` — ISSUE with any `LOCK_*` flag (v0 or v3).
- `"Destroying is irreversible — the tokens cannot be recovered."` — DESTROY (all versions).
- `"Token ticker is empty."` — ISSUE / MINT / DESTROY with empty `TICK`.
- `"Amount is not positive."` — MINT / DESTROY with `AMOUNT <= 0`.
- `"Memo contains | or ; — the protocol will reject this transaction."` — MINT / DESTROY / ISSUE.

**Private helpers** (file-local, not re-exported)

- `decodeIssue(params, chainName, chainSuffix)` — dispatches by `VERSION`.
- `decodeBatch(params, chainId, chainName, chainSuffix, chainRegistry)` — re-enters `decodeAction` for each command.
- `collectLockFlags(params)` — maps `LOCK_*` fields to human labels; treats `''`, `'0'`, `0`, `false`, `null`, `undefined` as inactive.
- `genericFallback(action, params, chainSuffix)` — existing catch-all, now reusable.

### Tests

- `packages/core/test/action-decoder.smoke.js` grows from 7 to 18 cases. New coverage: ISSUE v0 Meme-template shape (create + MAX_SUPPLY + locks), ISSUE v0 transfer-ownership-only, ISSUE v1 description-only, ISSUE v3 lock-params summary, MINT happy + broadcasting-address default + zero-amount warning, DESTROY v0 + multi-version fallback with irreversibility preserved, BATCH composed summary + Step-row details, empty-BATCH no-decoded-commands warning. SignApproval static wiring checks unchanged.

### Scope boundary

- Decoder output is **plain text strings**. The sign screen renders them; no HTML, no markup. Lock-flag labels are English ("max supply", "minting"), not protocol field names ("LOCK_MAX_SUPPLY") — the decoder's job is to translate protocol into human, not mirror it.
- `COMMANDS` is the wallet-side representation. The SDK ultimately serializes a BATCH to `BATCH|0|CMD1;CMD2` per protocol §BATCH v0; the decoder runs before serialization, on the authored-but-not-yet-encoded shape. A future enhancement could parse the on-wire form too, for dApp-origin sign requests — not needed today.
- Phase 2 sub-pieces 2b–2e (wizard scaffold, messaging, templates, Home entry) build on top of this decoder. ISSUE / MINT / DESTROY standalone forms (§40.2–§40.5, Steps 8–11) reuse it unchanged.
- DISPENSER / DIVIDEND / AIRDROP / BROADCAST / FILE decoders land alongside their authoring forms (Batch 2 — Steps 20–24).

### Smoke-runner regressions surfaced + fixed

Running `node packages/core/test/_run-smokes.js` after the decoder work flushed out three pre-existing regressions that had slipped through earlier releases (pnpm wasn't available in the sandbox where those pieces were proposed, so the smoke suite never ran end-to-end). All three are static/wiring fixes — no runtime behavior changed:

- `packages/core/src/index.js` no longer re-exports the `shared` namespace. The shared surface pulls `.jsx` files which Node's native ESM loader can't parse, so `import { decoder } from '@xchain-wallet/core'` broke the moment the namespace alias was followed. Consumers already reach shared via the subpath export (`@xchain-wallet/core/shared/MessagingProvider.jsx`); the namespace alias was dead weight introduced in v0.46.0.
- `packages/core/test/popup-shell.smoke.js` — stale from v0.46.0. It iterated `popup/routes/Loading.jsx` + friends that got hoisted to shared and deleted. Replaced with assertions that the popup App.jsx pulls the 8 shared routes + wraps in `<MessagingProvider shell="popup">`.
- `packages/core/test/sdk-bundle.smoke.js` — the "shim doesn't re-import `ws`" assertion in v0.47.0 was naive substring-matching and tripped on the JSDoc example at the top of `ws-browser.js` that cites `require('ws')` as the consumer call site. Now strips comment lines before the check.

## [0.47.0] - 2026-04-23

Phase 2 Batch 1 piece 1b — real `xchain-sdk` browser-bundle pass. Makes both shell Vite builds resolve the real SDK end-to-end so every Phase-2 authoring form (ISSUE, MINT, wizard, etc.) has a working encode + sign path from day one instead of dead-ending at the dev-mock fallback. Surfaces the three CJS/Node-builtin interop issues once, not per-form.

### Added

**Browser shims** (`packages/core/src/shims/`)

- `ws-browser.js` — wraps native browser `WebSocket` in a Node-`ws`-shaped adapter. The SDK's `websocket.js` calls `.on('open'|'message'|'close'|'error', fn)` + reads `WebSocket.OPEN`-style static constants; browser `WebSocket` exposes `.addEventListener` / `onopen`. Shim translates, plus handles `close(code, reason)` / `readyState` / `send(data)`. Throws loudly if `globalThis.WebSocket` is unavailable.
- `http-browser.js` — no-op `http.Agent` class so `encoder.js` + `explorer.js`'s `new (require('http').Agent)({ keepAlive: true })` connection-pool init resolves without pulling in the 30 KB `stream-http` polyfill. Browsers manage their own connection pool; axios's `httpAgent` is a no-op there.
- `repl-browser.js` — throws if `startREPL()` is ever called. `xchain-sdk/index.js` transitively loads `src/repl.js` at module init via `require('./src/repl.js')`, which calls `require('repl')`. The wallet never calls `startREPL`; the shim lets the module graph resolve without shipping a real polyfill for `node:repl`.
- `packages/core/package.json` exports `./shims/*` so Vite configs resolve the shim paths via `@xchain-wallet/core/shims/*`-style imports (today the configs use `fileURLToPath(new URL(...))` because Vite's `resolve.alias` values are filesystem paths, not package-subpath imports).

**Vite config wiring** (`packages/web/vite.config.js`, `packages/extension/vite.config.js`)

- `vite-plugin-node-polyfills` added with `include: ['buffer', 'process', 'crypto', 'events', 'stream', 'util']` + `globals: { Buffer: true, process: true, global: true }` + `protocolImports: true`. Covers `require('crypto')` in `auth.js` + `messaging.js` (ECDH, AES-256-GCM, randomBytes, SHA-256), Buffer in `bitcoinjs-lib`, and `process` in a few transitive deps.
- `resolve.alias` maps `ws` → `ws-browser.js`, `http` → `http-browser.js`, `repl` → `repl-browser.js`. Aliasing at the Vite level means we don't touch `xchain-sdk` source.
- Extension Vite config keeps its existing multi-entry shape (background / contentScript / xchainProvider / popup / approval). Tree-shaking keeps the polyfills + shims out of `contentScript` + `xchainProvider` bundles since those don't consume xchain-sdk.

**Runtime + dev deps**

- `vite-plugin-node-polyfills@^0.22.0` added as devDep to `packages/web` + `packages/extension`. `packages/core` already depended on `@noble/hashes` + `@scure/*` directly — not using crypto-browserify.
- `xchain-sdk@^1.8.0` already pinned in both shells from v0.45.0.

### Tests

- **New smoke** — `packages/core/test/sdk-bundle.smoke.js`. Verifies: the three shim files exist + expose the expected surface; both Vite configs import `vite-plugin-node-polyfills` and call `nodePolyfills()` with the right include list + global Buffer flag; both configs resolve `ws` / `http` / `repl` via alias to the shims; both package.json files pin `xchain-sdk` at `^1.8.0` and list `vite-plugin-node-polyfills` as a devDep; both `sdkFactory.js` files still dynamic-import `xchain-sdk` + wrap with `adaptXChainSDK` + emit the console.warn markers `check-no-dev-mock.sh` greps for; `tools/build-reproduce/check-no-dev-mock.sh` still names all three markers.

### Scope boundary

- **Static smoke only.** The full "does it actually bundle" gate is `pnpm -C packages/web build && pnpm -C packages/extension build && bash tools/build-reproduce/check-no-dev-mock.sh`. Those run in CI + before a release; the smoke asserts the static wiring, not the bundle itself.
- **Messaging features are Phase 3.** The SDK's `src/messaging.js` uses `crypto.createECDH('secp256k1')` and AES-256-GCM for §MESSAGE ECIES. Bundling the module graph works (crypto-browserify supports both), but the wallet doesn't invoke messaging flows until Phase 3 (§41.x). Any runtime-only bugs in the polyfill path there surface later; Phase 2 authoring (ISSUE/MINT/wizard/HW signers) doesn't touch messaging.
- **ws shim is minimal.** It implements the `.on / .off / .once / .send / .close / .terminate / readyState / url / protocol / bufferedAmount` surface the SDK's `websocket.js` consumes plus `CONNECTING / OPEN / CLOSING / CLOSED` static constants — not a general-purpose `ws` polyfill. If the SDK adds new WebSocket call sites in a future version, the smoke fails at bundle time and the shim gets extended.
- **http shim is intentionally a stub.** If the SDK starts doing anything beyond `new http.Agent()`, the browser bundler hits an undefined-property error and we notice. We don't want to quietly pull in `stream-http` (30 KB) for features the wallet doesn't use.

### Known follow-ups

- The full `pnpm -r build` + `check-no-dev-mock.sh` gate is scoped to CI — the user runs it locally when they want visual confirmation. A reproducible-build RC pass (§51.4) adds the gate automatically pre-release.
- If `bitcoinjs-lib`'s browser surface reports an ESM/CJS interop issue in the bundle log, the fix is typically a `optimizeDeps.include: ['bitcoinjs-lib']` entry in the Vite config — not shipped today because pre-bundling it may not be necessary with `@vitejs/plugin-commonjs` built-in handling.

## [0.46.0] - 2026-04-23

Phase 2 Batch 1 piece 1 — shared-routes refactor. Closes the Phase-1 popup-Send + web-Receive gaps by hoisting every Phase-1 route into `@xchain-wallet/core/shared/routes/*` behind a `MessagingProvider` React context. Popup + web shells become thin routers that wrap the tree with `<MessagingProvider shell="popup|web" messaging={shellMessaging}>`; shared routes call the bag of messaging helpers via the context and pick `Screen` variants from `screenVariantFor(shell)`.

### Added

**Shared surface** (`packages/core/src/shared/`)

- `MessagingContext.js` + `MessagingProvider.jsx` + `useMessaging.js` — React context + hook wrapping a `{ shell, messaging }` value. `useMessaging` throws when consumed outside a provider so wiring mistakes surface immediately. `screenVariantFor(shell)` returns `'popup' | 'full'`.
- `hooks/useAutoLock.js` — hoisted from the popup; now a shared foreground auto-lock timer. `enabled: false` makes it a no-op so shells that don't want it (web today) can still call the hook unconditionally per React hook rules.
- `components/MnemonicGrid.jsx` — shared read-only seed-phrase grid. `variant="popup"` renders the compact 3-col layout; `variant="full"` picks a responsive 3/4-col grid for the full layout.
- `components/ChainBalanceCard.jsx` — shared per-chain balance card (hoisted from popup).
- `routes/Loading.jsx`, `Onboarding.jsx`, `CreateWallet.jsx`, `ImportWallet.jsx`, `Locked.jsx`, `Home.jsx`, `Send.jsx`, `Receive.jsx` — every Phase-1 route + its `.module.css`. Each route reads `shell` from context and picks its layout variant; each CSS module co-locates `-popup` / `-full` class variants where sizing diverges.
- `shared/index.js` barrel + `packages/core/src/index.js` namespace export (`import { shared } from '@xchain-wallet/core'`).
- `packages/core/package.json` exports map extended with `./shared` and `./shared/*`.

**Closing the Phase-1 gaps**

- **Popup gains Send** — popup `App.jsx`'s `unlockedView` now tracks `home | send | receive`; Home's Send button is live. `packages/extension/src/popup/messaging.js` adds a `sendAsset` helper targeting the host's `action.send` handler.
- **Web gains Receive** — web `App.jsx` adds the `receive` sub-route and renders the shared `Receive`. `packages/web/src/messaging.js` adds a `generateReceiveAddress` helper targeting the host's `receive.getAddress` handler.
- **Review shape converged** — shared `Send.jsx`'s review stage runs the user's draft through `decoder.decodeAction` so the plain-English summary + warnings banner match SignApproval's sign-screen. Memo `|` or `;` surfaces the same protocol-reject warning in both surfaces.
- **Create flow converged on safer pattern** — shared `CreateWallet.jsx` generates the BIP39 mnemonic client-side and persists post-confirm via `messaging.importMnemonic`, matching the web shell's existing behavior. A user who closes the popup/tab at the mnemonic display stage leaves no vault behind (§19.2).

### Changed

- `packages/web/src/App.jsx` — `<ExtensionBanner>` hoisted to App-level above the router (previously per-route in Locked + Onboarding). Auto-hiding behavior is unchanged; the banner only renders when `window.xchain` is detected and not dismissed for the session. Double-render regression on Onboarding is impossible because the per-route `<ExtensionBanner>` was deleted.
- Popup + web `App.jsx` are now thin: wrap in `<MessagingProvider>`, dispatch by state, pass `shell`/`messaging` through context. All route files live in `@xchain-wallet/core/shared/routes/`.

### Removed

Per-shell duplicates (hoisted to shared):

- `packages/extension/src/popup/routes/*.{jsx,module.css}` — Locked, Loading, Onboarding, CreateWallet, ImportWallet, Home, Receive (all gone).
- `packages/extension/src/popup/components/{MnemonicGrid,ChainBalanceCard}.{jsx,module.css}` — gone.
- `packages/extension/src/popup/hooks/useAutoLock.js` — gone.
- `packages/web/src/routes/*.{jsx,module.css}` — Locked, Loading, Onboarding, CreateWallet, ImportWallet, Home, Send (all gone).
- `packages/web/src/components/MnemonicGrid.{jsx,module.css}` — gone.
- `packages/web/src/components/ExtensionBanner.{jsx,module.css}` — retained (web-shell-specific chrome).

### Tests

- **New smoke** — `packages/core/test/shared-routes.smoke.js`. Asserts the core exports map, the 25 shared files exist, each route reads `useMessaging()` + calls its helpers via `messaging.X(...)` + drives `Screen` from `screenVariantFor`, both App.jsx wrap in `<MessagingProvider>` and import the 8 shared routes, the old per-shell duplicates are deleted, and both messaging modules expose the full surface (`unlockWallet`, `lockWallet`, `listWallets`, `getWalletBalances`, `getAddressesByChain`, `getNewestAddress`, `generateReceiveAddress`, `createWallet`, `importMnemonic`, `sendAsset`).
- **Smokes updated** — `web-shell`, `web-send`, `web-onboarding`, `popup-shell`, `extension-onboarding`, `receive-view`, `home-lock`, `unlock-flow`, `e2e-harness` all re-target the shared paths and the `messaging.X` call convention. Behavioral assertions (real Vault round-trips against fake chrome.storage / fake IndexedDB) keep the same shape — only the static-regex checks moved.

### Scope boundary

- No new authoring features land in this piece. Token Creation Wizard (§40.1) + ISSUE/MINT/DESTROY (§40.2–§40.5) come next, building on the shared-routes surface.
- Auto-lock stays popup-only for today (web shells opt out via `enabled: shell === 'popup' && !locking`). Cross-shell parity for auto-lock is a later polish.
- Extension popup + web now both render the same `Home.jsx`. The full-screen Home uses a responsive grid of `ChainBalanceCard`s; the popup gets a single-column stack of the same cards — card internals unchanged.

## [0.45.0] - 2026-04-22

Closes out Phase 1's buildable surface. One combined release covering Batch 5 (Vitest in core, Playwright harness, i18n scaffold, axe-core CI gate) + piece 19 (real SDK wiring), piece 20 (extension popup onboarding), piece 21 (threat-model artifact), and piece 22 (reproducible-build scaffold). Released as a single version because the pieces together cross the "Phase 1 shippable" line — the release-gate checklist in `IMPLEMENTATION_STATUS.md` drops from every-item-open to "external review + signed releases" as the remaining gate.

### Added

**Piece 15 — Vitest in `core`** (§52.2)

- `packages/core/vitest.config.js` — jsdom env, `@vitejs/plugin-react` for JSX, `test/**/*.test.{js,jsx}` include, `*.smoke.js` excluded so the Node-script smokes run untouched, v8 coverage provider. Coverage thresholds deliberately unset until the suite grows toward §52.2's 80% target.
- `packages/core/test/setup.js` — loads `@testing-library/jest-dom/vitest`, polyfills `webcrypto` on Node 18.
- `packages/core/test/_run-smokes.js` — discovery-based runner wraps every `*.smoke.js` behind `pnpm -C packages/core test:smoke`.
- Vitest suites (`*.test.{js,jsx}`, 5 files, 25 cases): `decoder.test.js`, `ui/Button.test.jsx`, `ui/Input.test.jsx`, `ui/ChainBadge.test.jsx`, `ui/CopyButton.test.jsx`.
- `packages/core/package.json` — `test` / `test:watch` / `test:coverage` / `test:smoke` scripts + Vitest devDep set.
- `.gitignore` excludes `/packages/*/coverage`.

**Piece 16 — Playwright harness** (§52.4)

- `e2e/` workspace package with `playwright.config.js` (Chromium, workers=1, `webServer` spawns `pnpm -C packages/web dev`, traces + video + screenshots on failure), README runbook.
- `tests/onboarding.spec.js` — 4 cases: create/lock/unlock round-trip, wrong-password error, BIP39 import, word-count validation.
- `tests/send-form.spec.js` — 4 cases: review round-trip with form-state preservation, `|;` memo rejection, zero-amount rejection, broadcast attempt surfaces SDK-stub error.
- `.github/workflows/ci.yml` — new Playwright job; existing install job gains `pnpm -r test` + `pnpm -C packages/core test:smoke`.
- `pnpm-workspace.yaml` includes `e2e`.

**Piece 17 — i18n scaffold** (§54)

- `packages/core/src/i18n/en.js` (57 keys) + `index.js` with `t()`, `format()`, `setLocale`/`registerLocale`/`onLocaleChange`/`availableLocales`. Missing keys fall back to English then to the key itself.
- Re-exported as the `i18n` namespace from core's `index.js`.

**Piece 18 — axe-core CI gate** (§53)

- `e2e/tests/a11y.spec.js` scans every Phase-1 screen against WCAG 2.1 A + AA tags. Helper surfaces the violation list in failure messages.
- `@axe-core/playwright` added as an e2e devDep.

**Piece 19 — real `xchain-sdk` wiring**

- `packages/web/src/sdkFactory.js` + `packages/extension/src/background/sdkFactory.js` — shared-shape resolvers that dynamic-import `xchain-sdk`, wrap via `core.sdk.adaptXChainSDK`, and fall back to a clearly-flagged dev mock when the package isn't resolvable. Single `console.warn` on fallback.
- `hostBridge.sdkResolved` / `background.sdkResolved` — promises that settle with `'real' | 'dev-mock'`.
- `xchain-sdk@^1.8.0` as a runtime dep on both shells.

**Piece 20 — extension popup onboarding**

Closes the `TEST_DAPP_RUNBOOK` bootstrap gap for the extension.

- `packages/extension/src/background/walletCreate.js` — pre-host `wallet.create` / `wallet.import` handlers. `WalletExistsError` idempotence guard.
- `sessionMeta.js` dispatcher + `PRE_HOST_MESSAGE_TYPES` now covers `wallet.create` + `wallet.import`; accepts `chainRegistry` + (lazy-bound) `sdkRegistry` deps.
- Popup routes: `CreateWallet.jsx`, `ImportWallet.jsx`, `components/MnemonicGrid.jsx` (+ CSS) — popup-sized variants of the web onboarding flows.
- Popup `App.jsx` adds the `welcome | create | import` sub-route.
- Popup `messaging.js` gains `createWallet` + `importMnemonic` helpers.

**Piece 21 — threat-model artifact** (§12)

- `docs/THREAT_MODEL.md` — full draft covering protected assets, in/out-of-scope threats, 5 attacker scenarios with code-pointer mitigations, known open items, review cadence, and a Verification section cross-referencing smoke tests. Release-gating-checklist item has a concrete artifact to hand to reviewers.

**Piece 22 — reproducible-build scaffold** (§51.4)

- `tools/build-reproduce/README.md` — pinning notes, verify-script plan, current gotchas, RC checklist.
- `tools/build-reproduce/check-no-dev-mock.sh` — pre-release gate greps built `dist/` for dev-SDK fallback markers. Fails the pipeline if found → guarantees `xchain-sdk` resolved during the production build.

### Tests

Six new smokes (auto-discovered by `_run-smokes.js`): `sdk-wiring`, `e2e-harness`, `vitest-setup`, `i18n`, `a11y-harness`, `extension-onboarding`, `release-gates`. 21 smokes total; all pass.

### Scope boundary — Phase 1 remaining

Remaining items are external/operational:

- Real broadcast testing on regtest (SDK resolution + live stack).
- External threat-model review (doc is ready).
- Legal review of user-facing copy (i18n scaffold ready).
- Signed releases (needs certs + signing key).
- Manual accessibility audit (screen-reader pass; axe covers the programmatic side).
- Reproducible-build verification (scaffold + gate shipped; `RELEASE_MANIFEST.txt` from the release pipeline closes the loop).

Every "pending" item in `IMPLEMENTATION_STATUS.md` that a single codebase commit could deliver has been delivered.

## [0.44.0] - 2026-04-22

### Added

**Plain-English action decoder + sign-screen upgrade** (§21.1, §30) — Batch 4 piece 14

Closes out Batch 4.

- `packages/core/src/decoder/actionDecoder.js` — pure function:
    ```
    decodeAction({ action, params, chainId, chainRegistry })
      → { summary: string, details: Array<{ label, value }>, warnings: string[] }
    ```
  Phase 1 covers SEND + SWEEP with human sentences ("Send 100 MYTOKEN on Bitcoin to bc1q…", "Sweep all assets on Dogecoin to bc1q…"). Every other ACTION kind gets a generic fallback that pretty-prints the params and surfaces a "no plain-English summary yet" warning — dedicated decoders for ISSUE / MINT / DISPENSER / etc. land alongside their authoring forms in later phases.
  
  Warnings it raises:
  - Memo containing `|` or `;` (protocol rejects the tx).
  - SEND with amount ≤ 0 or empty destination.
  - SWEEP blanket "moves every balance at the source address" reminder + empty-destination warning.
  - Unknown action "no summary yet" notice.

- `packages/core/src/index.js` re-exports the `decoder` namespace so both shells reach it via `import { decoder } from '@xchain-wallet/core'`.

- `packages/extension/src/approval/kinds/SignApproval.jsx` — `signAction` summary block now calls `decoder.decodeAction`. Renders the human summary line, a proper `<dl>` details list (labeled rows, not raw JSON), and a warnings alert styled as a yellow banner above the password input.

- `packages/extension/src/approval/kinds/SignApproval.module.css` — new styles for `.detailsList` / `.detailsRow` / `.detailsLabel` / `.detailsValue` and the `.warnings` alert block.

### Scope boundary

- **PSBT summary stayed raw-hex** — structural PSBT parsing needs `bitcoinjs-lib`. Until the real SDK is bundled, showing `psbtHex` truncated + signing paths is the honest fallback; no fake parser.
- **Web `Send.jsx` still uses its own review layout** — the review there renders structured rows (Chain / From / To / Asset / Amount / Memo) that differ from the decoder's flat `details[]` shape. Converging is a later polish pass; both paths render the same underlying data correctly today.
- **Rejection UX** is the existing Reject button + the warnings banner. §30's "once, clearly" anti-paternalism guideline means the decoder surfaces warnings inline without adding a confirm-dialog before Approve.

### Tests

- `packages/core/test/action-decoder.smoke.js` — 7 decoder cases (happy SEND, SEND with `|` memo → warning, SEND with zero amount + empty destination → two warnings, SWEEP blanket-balance warning, unknown-action fallback, no-chain-registry path, null-params safety) + static wiring for the core namespace re-export and SignApproval's import/use of the decoder.

## [0.43.0] - 2026-04-22

Covers Batch 4 pieces 12 + 13 (web onboarding + web Send). Bundled because both touch `packages/web/src/messaging.js` and `packages/web/src/App.jsx`; splitting would churn the same files without shipping anything different.

### Added

**Piece 12 — web onboarding: create + import** (§15.3, §19.2)

Closes the bootstrap gap called out in `TEST_DAPP_RUNBOOK.md` for web. Users can now create a fresh BIP39 wallet or import an existing 12/15/18/21/24-word phrase without hand-seeding IDB through DevTools.

- `packages/web/src/hostBridge.js`:
  - Replaced the throwing SDK scaffold with a clearly-flagged `createDevMockSdk` (DO NOT USE FOR MAINNET). Produces deterministic pseudo-addresses per (pubkey, addressType) so HD derivation completes during onboarding; signing / broadcast / message-signing still throw loudly. Real `xchain-sdk` bundling is a Batch 5 piece.
  - `createWalletLocal({ password, name, strengthBits, bip39Passphrase, activeChainIds })` — fresh kdfParams, master key, blank vault → `flows.createWallet` → save meta → host live. Returns `{ mnemonic, walletName }`.
  - `importMnemonicLocal({ password, mnemonic, name, bip39Passphrase, activeChainIds })` — same persistence path for an existing phrase (BIP39 or Counterwallet-legacy; format auto-detected).
  - Both helpers guard idempotence (second create / import against an existing meta rejects with "a wallet already exists").
  - `DEFAULT_ACTIVE_CHAIN_IDS` — BTC/DOGE/LTC mainnet. Users can change via Settings (later piece).
- `packages/web/src/messaging.js` — `createWallet` + `importMnemonic` helpers.
- `packages/web/src/routes/CreateWallet.jsx` (+ CSS) — 2-stage flow: password+confirm+name form → mnemonic display with "I've saved it" checkbox. Mnemonic is generated client-side via `cryptoLib.generateBip39Mnemonic` and **only persisted after** the user acks, via `importMnemonic` with the generated phrase — so a user who closes the tab at the display stage leaves no vault behind.
- `packages/web/src/routes/ImportWallet.jsx` (+ CSS) — textarea for the phrase (spell-check off, lowercase, no autocomplete), word-count validation (12/15/18/21/24), password + confirm, name.
- `packages/web/src/components/MnemonicGrid.jsx` (+ CSS) — numbered 3/4-column read-only grid. Deliberately no copy-to-clipboard button per §19 — seeds should be hand-written, not parked in clipboard history.
- `packages/web/src/routes/Onboarding.jsx` — activated the Create + Import buttons via new `onCreate` / `onImport` props.
- `packages/web/src/App.jsx` — added `no-wallet` sub-routing (`welcome | create | import`). Successful create/import leaves the host live; next `refresh()` transitions the app to Home without a separate unlock step.

**Piece 13 — web Send form + review** (§29 authoring)

- `packages/web/src/routes/Send.jsx` (+ CSS) — multi-stage authoring flow:
  - **form**: chain picker (when the wallet has addresses on >1 chain), auto-picked source address (highest external HD index on the chain), native-ticker default (`descriptor.coin.toUpperCase()`), recipient / asset / amount / memo inputs. Client-side validation: required fields, positive amount, protocol `|` + `;` memo rejection.
  - **review**: decoded summary (Chain / From / To / Asset / Amount / Memo) in a `<dl>` grid with an inline password input.
  - **submitting / done / error** states — `InvalidPasswordError` surfaces as "Incorrect password."; other errors surface raw and drop back to review with the form state hydrated so the user doesn't retype.
- `packages/web/src/messaging.js` — `sendAsset(opts)` helper targeting the host's `action.send` handler.
- `packages/web/src/App.jsx` — added `unlocked` sub-routing (`home | send`), caches active walletId at App level so Send reuses Home's single-wallet assumption.
- `packages/web/src/routes/Home.jsx` — activated the Send button via new `onSend` prop.

### Scope boundary

Real broadcast via Send is blocked by the dev-SDK stub — the flow exercises cleanly through form + review + password entry, then fails with a visible "xchain-sdk" / "not yet wired" error at the encoder step. Shipping real broadcast is a Batch 5 piece (SDK bundling).

Onboarding in the **extension popup** remains a stub — the popup route set hasn't been hoisted into shared components yet. That shared-routes refactor + popup onboarding land together in a later cleanup.

### Tests

- `packages/core/test/web-onboarding.smoke.js` — static wiring (App sub-routes, CreateWallet generates + persists via `importMnemonic`, ImportWallet's word-count validation, dev-SDK stub flagged) plus behavioural round-trips: real create → mnemonic returned + vault persisted + session=unlocked + `wallet.list` returns the seeded wallet + lock/unlock round-trip proves kdfParams persisted + idempotence guard rejects a second create; reset; import with a fresh BIP39 phrase + idempotence guard.
- `packages/core/test/web-send.smoke.js` — static wiring (stage coverage, validation rules, App/Home wiring) + end-to-end `action.send` round-trip against the dev-SDK stub: vault seeded, real source address resolved from the persisted addresses-by-chain result, `sendAsset` called, error surfaced as a structured rejection matching the expected "xchain-sdk / not yet wired / encoder" message.

## [0.42.0] - 2026-04-22

### Added

**Web SPA shell + extension-detection banner** (§8.1 target #1, §8.3, §9.3.3) — Batch 4 piece 11

The web SPA is now a real React app. Same state-machine topology as the extension popup, with routes rendered full-layout and messaging dispatched through an in-page MessageHost instead of `chrome.runtime`.

**In-page host bridge**

- `packages/web/src/hostBridge.js` — module-scoped `vault` + `host` that survive re-renders but die on tab close / reload (web's key-isolation tradeoff per §9.3.3). Exposes `getSessionStatus`, `unlockWalletLocal`, `lockWalletLocal`, and a `sendMessage(type, request)` dispatcher whose envelope shape matches the popup's `chrome.runtime.sendMessage` wrapper — so the later shared-routes refactor can swap shells without touching route code.
- `packages/web/src/storage/WebMetaBackend.js` — plaintext kdfParams slot at `xchain-wallet:vault-meta` in localStorage. Non-secret by Argon2id design; needed so the unlock flow can derive the master key before touching the IndexedDB ciphertext. Injectable `storage` adapter for tests.
- `packages/web/src/messaging.js` — popup-parity helpers (`unlockWallet`, `lockWallet`, `listWallets`, `getWalletBalances`, `getAddressesByChain`, `getNewestAddress`) wrapping `hostBridge.sendMessage`.

**SPA shell + routes**

- `packages/web/src/main.jsx` — React root. Imports `@xchain-wallet/core/ui/tokens.css` once so design-token custom properties install on `:root` for every route.
- `packages/web/src/App.jsx` — 5-state router matching the popup (`loading | error | no-wallet | locked | unlocked`), rendering the web routes with `Screen variant="full"`.
- `packages/web/src/routes/` — four routes + co-located CSS modules:
  - `Loading.jsx` — full-layout three-dot indicator.
  - `Onboarding.jsx` — stub hero + disabled create/import buttons pointing at piece 12. Wraps in `<ExtensionBanner />`.
  - `Locked.jsx` — real password form, same focus + error handling as the popup's Locked, routed through `unlockWallet()`. Wraps in `<ExtensionBanner />`.
  - `Home.jsx` — wallet-name header + Lock button + per-chain balance grid (via `ChainBadge`), disabled Send/Receive.
- `packages/web/src/components/ExtensionBanner.jsx` — §8.3 detection banner. Checks `window.xchain` on mount and listens for the inject-script's `xchain#initialized` event. Dismissal persisted to `sessionStorage` so it doesn't nag across navigations but reappears on a fresh tab.

**Build wiring**

- `packages/web/vite.config.js` enables `@vitejs/plugin-react`.
- `packages/web/index.html` — root div renamed to `xchain-web-root`, script src updated to `/src/main.jsx`.
- `packages/web/src/main.js` deleted.
- `packages/web/src/index.js` re-exports `WebMetaBackend` + namespace-exports `hostBridge`.

### Changed

- `packages/web/package.json` now depends on `@xchain-wallet/extension` for the shared `createBackgroundHost` factory. Flagged in `hostBridge.js` as a candidate for extraction into a lower-level `host-wiring` package when a third shell appears; importing via a cross-package relative path keeps Node smokes runnable without the pnpm workspace symlink while Vite resolves the same path cleanly at build.

### Scope boundary

Routes are intentionally duplicated between popup and web for this piece. A later cleanup piece hoists the shared ones into `src/shared/routes/` behind a `MessagingProvider` React context so both shells consume the same components. Onboarding remains a stub until piece 12.

### Tests

- `packages/core/test/web-shell.smoke.js` — static wiring (Vite plugin, index.html entry, App state coverage, Locked/Home/ExtensionBanner specifics, workspace deps) plus an in-page bridge lifecycle against a real AES-GCM vault with injected `localStorage` + IndexedDB fakes: fresh page → `no-wallet`, wrong-password unlock → `InvalidPasswordError` (state stays `locked`), right-password unlock → `unlocked` with a working `sendMessage('wallet.list')` round-trip returning the seeded wallet, `lockWalletLocal()` → `locked` + `sendMessage` rejects with `VaultClosedError`.

## [0.41.0] - 2026-04-22

### Added

**Batch 3 piece 10 — bridge end-to-end smoke + test-dApp runbook**

- `packages/core/test/bridge-e2e.smoke.js` — integration smoke that assembles the real Vault + MessageHost + ApprovalBroker (with a fake `chrome.windows`) and drives the full Phase-1 bridge surface through `host.handle`:
  - `bridge.connect` → approval parked → `approval.resolve` with the same envelope the popup sends → `ConnectedSite` written + response shape verified.
  - Second `connect` on the same origin is idempotent (no new approval window opens).
  - `bridge.getAccounts` / `getAddresses` / `getSupportedChains` (9 chains; `icon` elided as piece-1 shell follow-up intended).
  - `bridge.signAction` with `ISSUE` returns `{ error: 'UNSUPPORTED_ACTION', supportedActions: ['SEND', 'SWEEP'] }` without opening an approval.
  - `bridge.disconnect` removes the site.
  - Window-close-without-decision on a pending connect → dApp-side Promise rejects with `UserRejectedError`.
  - Test-dApp surface (`runExample` + `MockXChainProvider`) still exposes the symbols the runbook references — catches accidental drift.
- `packages/extension/docs/TEST_DAPP_RUNBOOK.md` — manual browser-pass runbook for RC builds. Covers build + load unpacked, bootstrap gap (seed a wallet via DevTools until Batch 4's onboarding lands), serving the test-dApp, walking `runExample` through each approval popup with expected outcomes, edge cases (reject / close / re-connect / always-allow / mid-flow lock), and a pointer at the node smoke for PR gate use.

### Scope boundary

Sign paths that hit the real SDK (`signMessage`, `signPsbt`, `signAction` SEND) are exercised up to the approval hand-off. Going further — i.e. producing a valid signed payload — needs the real SDK bundled into the extension, which ships in a later piece.

## [0.40.0] - 2026-04-22

Covers Batch 3 pieces 8 + 9 (approval window plumbing + per-kind approval screens). Bundled because piece 9 replaces piece 8's `approval/main.jsx` placeholder and extends `approval/messaging.js` — splitting would just churn the same files.

### Added

**Piece 8 — approval window plumbing** (§43.4 request-approval flow)

- `packages/extension/src/background/approvalBroker.js` — `ApprovalBroker` class implements the `Approvals` interface (`connect`, `signAction`, `signMessage`, `signPsbt`, `signIn`) by parking requests in an in-memory map, opening an approval popup via `chrome.windows.create`, and returning a Promise that settles when the popup calls back via `approval.resolve` or when the window is closed by the user (chrome.windows.onRemoved → resolves as `{ approved: false }` — the `USER_REJECTED` convention). Deps are injectable (`newId`, `getUrl`, `windows`) so tests can drive the lifecycle without a browser.
- `packages/extension/src/background/uuid.js` — `sessionRandomUUID()` falls back to `crypto.getRandomValues` when `randomUUID` isn't available so the broker is testable under older Node.
- `packages/extension/src/background/createBackgroundHost.js` registers two new host handlers gated on the broker having the methods:
  - `approval.fetch({ id })` — returns the parked `{ id, kind, payload }` for the approval window; surfaces `ApprovalNotFoundError` for unknown ids.
  - `approval.resolve({ id, result })` — settles the parked Promise. Closes the window via `chrome.windows.remove`.
- `packages/extension/approval.html` + `packages/extension/src/approval/main.jsx` — the approval-window entry. Piece 8 shipped a `<Placeholder />` to prove the window plumbing works end-to-end; piece 9 replaces it with a real Router.
- `packages/extension/vite.config.js` adds `approval` as a fourth HTML entry. The manifest doesn't reference `approval.html` directly — `chrome.runtime.getURL` does, so the plugin copy is enough.
- `packages/extension/src/background.js` constructs a module-scoped `ApprovalBroker` at startup (survives unlock/lock cycles) and passes it as `approvals` when building the host.

**Piece 9 — per-kind approval screens**

- `packages/extension/src/approval/Router.jsx` — dispatches by `data.kind` to the matching component. Shared `reject()` settles the broker with `{ approved: false }` before calling `window.close()` so the bridge handler sees a clean `USER_REJECTED` instead of the window-close fallback.
- `packages/extension/src/approval/kinds/ConnectApproval.jsx` (+ `.module.css`) — connect flow. Chain checkboxes enumerate `chainRegistry.supportedChains()`, pre-checking the dApp's `requestedChains` (empty default if none requested — user must opt into each). `canSignMessage` toggle (off by default). `canSignAction: {}` always empty; per-action opt-in happens at signAction time via its "Always allow" toggle. Connect disabled until at least one chain is selected.
- `packages/extension/src/approval/kinds/SignApproval.jsx` (+ `.module.css`) — shared screen for the four password-gated kinds (`signMessage`, `signPsbt`, `signAction`, `signIn`). Layout: chain badge → per-kind summary block → password input → optional "Always allow on this origin" toggle → Reject/Approve. `savePermanent` shows for `signAction` and for `signMessage` when the request's `alreadyGranted` flag is not set — `signPsbt` has no toggle because PSBTs vary enough per-transaction that a blanket allow is dangerous (§21.3). Result envelope: `{ approved: true, walletId, password, savePermanent? }`. `InvalidPasswordError` surfaces as "Incorrect password." inline; other errors show their raw message for diagnosis.
- `packages/extension/src/approval/approval.module.css` — shared header / footer / summary / toggle-row utilities.
- `packages/extension/src/approval/messaging.js` adds `listWallets()` so `SignApproval` can pick `wallets[0].id` as `walletId` for the sign-result envelope. Multi-wallet picker is Phase 2.

### Changed

- `packages/extension/src/shared/chromeMessaging.js` — extracted the `sendMessage` wrapper so both `popup/messaging.js` and `approval/messaging.js` can consume the same implementation without either depending on the other.
- `packages/extension/src/popup/messaging.js` — now re-imports `sendMessage` from the shared module (popup-facing helpers unchanged).
- `packages/core/test/popup-shell.smoke.js` — regex that checks for `sendMessage` accepts both direct-export and re-export forms.

### Tests

- `packages/core/test/approval-broker.smoke.js` — static wiring + full broker lifecycle against a fake `chrome.windows`: connect → fetch → resolve round-trip, double-resolve no-op, unknown-id returns, window-close → `{approved: false}`, missing-windows rejection, plus a real MessageHost round-trip that verifies `approval.fetch` returns the parked payload, unknown ids surface `ApprovalNotFoundError`, and `approval.resolve` settles the pending bridge Promise.
- `packages/core/test/approval-screens.smoke.js` — static wiring for Router / ConnectApproval / SignApproval (dispatch by kind, result-envelope fields, kind coverage, savePermanent conditional, InvalidPasswordError pathway) + three broker round-trips that simulate each kind of popup result envelope and verify the bridge-side Promise resolves with exactly those fields.

## [0.39.0] - 2026-04-22

### Added

**Receive view + BIP21 QR** (§29.7 receive flow, §29.10 BIP21 URI) — Batch 2 piece 7

- `packages/extension/src/popup/routes/Receive.jsx` + `.module.css` — full Receive surface:
  - Chain picker (native `<select>`) when the wallet has addresses on multiple chains; single `ChainBadge` header otherwise. Picker is filtered to chains the wallet already owns an address on — "add a new chain" is a later onboarding flow.
  - Newest persisted external HD address for the picked chain, rendered as a BIP21-encoded QR via `qrcode@^1.5.4`. QR uses error-correction level `M`, 200px wide, `#0F172A` on `#FFFFFF` so contrast holds in both themes.
  - Address pane uses `<AddressText truncate={false}>` + `<CopyButton>` so the full string is visible + one-tap copyable.
  - "New address" button opens an inline password form that calls `receive.getAddress`. The password prompt is required because HD seed decryption re-runs Argon2id per derivation (§26 — password-never-stored posture); the current-newest address is displayed without a prompt so routine "send me some" traffic doesn't trigger the KDF.
  - ← Back control returns to Home.
- **Two new pre-password host handlers** in `createBackgroundHost.js`:
  - `addresses.byChain({ walletId })` → `Record<chainId, Address[]>` — used to build the Receive picker.
  - `addresses.newest({ walletId, chainId, addressType? })` → newest external-index HD address (change=0), or `null`. Skips imported WIFs and internal (change=1) addresses.
- `packages/extension/src/popup/App.jsx` — popup-local sub-route within the `unlocked` state: `home | receive`. Active walletId is cached at App level so Receive can reuse Home's single-wallet assumption without re-querying `wallet.list`.
- `packages/extension/src/popup/routes/Home.jsx` — `Receive` button activated via a new `onReceive` prop (disabled when the prop is absent).
- Messaging: `getAddressesByChain(walletId)`, `getNewestAddress(walletId, chainId)`, `generateReceiveAddress({ walletId, chainId, password, bip39Passphrase?, addressType? })`.

### Changed

- `packages/extension/package.json` adds `qrcode@^1.5.4` as a runtime dependency.

### Tests

- `packages/core/test/receive-view.smoke.js` — drives both new handlers end-to-end against a real Vault seeded with BTC-mainnet external (indexes 0/1/2) + internal (change=1) + a DOGE address + a second wallet's address-that-must-not-leak. Asserts: byChain buckets cleanly, newest picks the highest external index and skips change=1 + other wallets, null for chains with no persisted addresses, missing-field rejection, plus a BIP21 encode/parse round-trip proving the QR payload is reversible.

## [0.38.0] - 2026-04-22

Covers Batch 2 pieces 5 + 6 (real unlock screen + Home screen with `wallet.lock` + foreground auto-lock). Bundled because both pieces touch `sessionMeta.js` + `messaging.js`; splitting the commit would require churn without shipping anything different.

### Added

**Piece 5 — unlock flow** (§26 lock/unlock)

- **Pre-host dispatcher** — `packages/extension/src/background/sessionMeta.js` refactored from a single-type listener into a dispatcher. Exports `PRE_HOST_MESSAGE_TYPES` (authoritative set the host listener skips) and handles `session.status` + `wallet.unlock`. `ChromeRuntimeAdapter` now consults that set directly instead of a `session.*` prefix check — keeping the two listeners disjoint without convention-coupling.
- **`wallet.unlock` handler** — `packages/extension/src/background/walletUnlock.js` derives the vault master key via `cryptoLib.deriveMasterKey`, authenticates by opening the encrypted blob (AES-GCM tag mismatch ⇒ `InvalidPasswordError`), seeds the session backend, and fires `onUnlocked()` so background can re-init the host. `NoVaultError` surfaces when no kdfParams meta is planted; empty-password guarded at the boundary.
- **Plaintext meta storage** — `packages/extension/src/storage/ChromeMetaBackend.js` stores vault kdfParams at `xchain-wallet:vault-meta`. Non-secret by design (Argon2id salt is public; memory/iterations are tuning info). Needed because the master key must be derived from password before the ciphertext can be touched.
- **Locked screen** — `src/popup/routes/Locked.jsx` is now a functional password form: auto-focus on mount, auto-re-focus+select on failure, `<Input type="password" autoComplete="current-password">`, `<Button type="submit" loading>` for inline spinner, Enter-to-submit via native `<form>`. `InvalidPasswordError` surfaces as "Incorrect password." — other errors show the raw message (bugs worth seeing).
- `unlockWallet(password)` added to `src/popup/messaging.js`.

**Piece 6 — Home screen + wallet.lock + foreground auto-lock**

- **`wallet.lock` handler** — `packages/extension/src/background/walletLock.js` clears the session backend and fires `onLocked()`. Added to `PRE_HOST_MESSAGE_TYPES` (with a matching dispatch case). Idempotent — safe to call when there's already no session.
- **Background teardown** — `background.js` captures `attachChromeRuntime`'s detach fn, defines `tearDownHost()` (detach listener + `vault.close()` + null refs), and passes it as `onLocked`. A subsequent unlock starts from a clean slate; stale vault references can't leak across a lock boundary.
- **Home screen** — `src/popup/routes/Home.jsx` ships the full unlocked-wallet landing view:
  - Header: wallet name (from `wallet.list[0]` — single-wallet Phase 1 scope; picker is a later piece) + `Lock` button with loading state.
  - Body: per-chain `<ChainBalanceCard>` rendered from `balances.wallet`. Graceful error fallback for each chain card so the SDK-stubbed state (every entry carries an `error`) renders as informative text instead of a crash. Empty-wallet hint when no addresses exist.
  - Actions: disabled `Send` + `Receive` with an inline note pointing at their later pieces.
- **ChainBalanceCard** — `src/popup/components/ChainBalanceCard.jsx` + `.module.css`. Card with a `ChainBadge` header, address-count sub-label, and a fallback body that surfaces the SDK error when all entries failed.
- **`useAutoLock` hook** — `src/popup/hooks/useAutoLock.js` foreground auto-lock (§26). 5-min default, 30s tick, listens for mousemove / keydown / scroll / click / touchstart. Calls `onLock()` once the idle threshold is crossed. Documents the scope gap: background-mediated auto-lock (survives popup close/reopen) is a later piece.
- `lockWallet()` / `listWallets()` / `getWalletBalances(walletId)` added to `messaging.js`.

### Changed

- `packages/extension/src/storage/index.js` re-exports `ChromeMetaBackend` + `DEFAULT_META_KEY`.
- `packages/extension/src/background/ChromeRuntimeAdapter.js` imports `PRE_HOST_MESSAGE_TYPES` and defers those types to the meta listener (replaces the piece-4 `session.*` prefix check).
- `packages/core/test/popup-shell.smoke.js` adapted to the new `attachSessionMetaListener(deps, chromeRuntime)` signature + the new adapter filter wording.

### Tests

- `packages/core/test/unlock-flow.smoke.js` — real-crypto round-trip. Builds a genuine AES-GCM vault blob via the core `Vault`, plants kdfParams in the meta slot, and drives `wallet.unlock` through four behavioural cases: no-vault, right-password (unlock + session seeded + `onUnlocked` fired), wrong-password (`InvalidPasswordError`, session untouched), empty-password (boundary guard).
- `packages/core/test/home-lock.smoke.js` — static wiring of Home / messaging / useAutoLock / ChainBalanceCard / background teardown, plus behavioural cases for `wallet.lock`: lock-from-unlocked (session cleared + `onLocked` fires + status flips to `locked`) and lock-without-session (idempotent, callback still fires).

Both new smokes install `webcrypto` from `node:crypto` onto `globalThis.crypto` since Node 18 exposes it only under the experimental flag and `@noble/hashes` + AES-GCM both reach for the bare global.

## [0.37.0] - 2026-04-22

### Added

**Extension popup HTML entry + React root + session-meta listener** (§8.1 target #3, §9.3.1 process isolation)

The popup is the user's primary entry point to the wallet. This piece ships the shell: HTML entry, React root, hash-free state-machine router, and the background wiring that lets the popup answer "what do I render?" without demanding an unlocked vault.

**Popup shell**

- `packages/extension/popup.html` — at the package root so MV3 can reference `popup.html` directly out of `dist/`. Mounts `<App />` into `#xchain-popup-root` via a type-module script tag pointing at `src/popup/main.jsx`.
- `packages/extension/src/popup/main.jsx` — `createRoot(container).render(<App />)`; imports `@xchain-wallet/core/ui/tokens.css` once so every route inherits the design-token palette + dark-mode + reduced-motion handling.
- `packages/extension/src/popup/App.jsx` — 5-state router: `loading → no-wallet | locked | unlocked | error`. Queries `session.status` on mount, renders the matching route, and passes each route a `refresh()` callback so flows that change state (create wallet, unlock, lock) re-pull ground truth from the background.
- `packages/extension/src/popup/messaging.js` — `sendMessage(type, request)` wraps `chrome.runtime.sendMessage` in a Promise. Surfaces the MessageHost `{ok, result} | {ok, error}` envelope as resolve/reject and preserves the error-class name. `getSessionStatus()` is the named query.
- `packages/extension/src/popup/routes/` — four route stubs with co-located CSS modules:
    - `Loading.jsx` — animated three-dot pulse indicator; static under `prefers-reduced-motion`.
    - `Onboarding.jsx` — logo hero + tagline from `branding.js`; "Create a new wallet" / "I already have one" buttons (disabled — real flows land in Batch 4).
    - `Locked.jsx` — scaffold stub; real password form + `unlockWallet` wiring lands in piece 5.
    - `Home.jsx` — scaffold stub with a header "Lock" trigger so the state machine is exercisable end-to-end; balances / send / receive land in pieces 6–7.

**Background session-meta listener**

The popup renders first-thing-on-open — before any unlock flow has run. `MessageHost` requires an open Vault, so a vault-less question like "is there a wallet?" couldn't be asked through it. The session-meta listener plugs that gap.

- `packages/extension/src/background/sessionMeta.js` — `attachSessionMetaListener(chromeRuntime?)` installs a `chrome.runtime.onMessage` listener that answers one type (`session.status`) from the two storage backends directly. Returns `{ hasWallet, hasSession, state }` where `state ∈ {'no-wallet', 'locked', 'unlocked'}`. Returns `false` for any non-`session.*` message so the host listener picks those up normally.
- `packages/extension/src/background/ChromeRuntimeAdapter.js` — host listener now returns `false` for `session.*` message types so the two listeners stay disjoint (prevents double-`sendResponse` on the same message).
- `packages/extension/src/background.js` — `attachSessionMetaListener()` runs before `ensureHost()` so the popup gets an answer even when the vault is still locked. Host listener attaches once the session key is present.

**Vite wiring + manifest + app icons** (§9.5, §51)

- `packages/extension/vite.config.js` — `@vitejs/plugin-react` enabled; fourth entry added (`popup` pointing at `popup.html`) so Vite's HTML pipeline produces `dist/popup.html` + a hashed `assets/popup-<hash>.js`. New `iconResizePlugin` uses `sharp` to resize `packages/core/src/branding/assets/favicon.png` (128×128 source) into MV3-standard 16 / 32 / 48 / 128 PNGs at `dist/icons/icon-<size>.png` on every build.
- `packages/extension/manifest.json` — added top-level `icons` + `action.default_popup = "popup.html"` + `action.default_icon` at all four sizes.
- `packages/extension/package.json` — `sharp@^0.33.5` devDep (consumed only by the icon-resize plugin at build time).

### Tests

- `packages/core/test/popup-shell.smoke.js` — 13 static-wiring checks (popup HTML, React entry, App state coverage, route exports, Vite config plugins + popup input + icon sizes, manifest popup/icon references, sharp devDep, background listener wiring) plus a runtime test that installs the session-meta listener against a fake `chrome.runtime` + `chrome.storage` and drives it through all three wallet states (no-wallet / locked / unlocked) plus a non-session-message passthrough check.

## [0.36.0] - 2026-04-22

### Changed

**Electron desktop shell moved out of Phase 1 into Phase 2** (spec §40.12)

Rationale: the desktop shell's headline differentiators over web + extension are (a) OS keychain integration and (b) native USB/HID hardware-wallet transports. Hardware signers (`TrezorSigner` / `LedgerSigner`) are Phase 2 per §17.3–17.4, so shipping the desktop shell in Phase 1 would mean a desktop app whose standout features are stubs. Bundling the two into Phase 2 (§40.11 Hardware Wallets + §40.12 Electron Desktop) delivers the desktop app with its value intact.

- `packages/desktop/package.json` — description flagged as "Phase 2 stub; ships alongside hardware signers per spec §40.12."
- `packages/desktop/README.md` — new; explains the deferral + points at spec §40.12. Phase 1 users get the web SPA + Chrome extension (both cover the full send/receive/sign surface).

Spec + IMPLEMENTATION_STATUS updates land in the platform working-copy (gitignored from this repo):

- §8.1 Phase 1 targets table no longer lists Electron desktop
- §8.2 deferred targets table adds the Electron desktop row with a Phase 2 marker
- §39.1 Phase 1 per-target delivery drops "Desktop (Electron) with OS keychain"
- §39.2 Phase 1 out-of-scope adds "Electron desktop shell → Phase 2"
- §40.12 new subsection "Electron Desktop Shell Goes Live" covers main-process signing isolation, OS keychain (safeStorage / keytar), native Trezor / Ledger node transports, URI scheme registration, `electron-builder` packaging + signing, and reproducible builds
- IMPLEMENTATION_STATUS scope-change note + Target-Matrix row + Shell-layer descriptions refreshed to match

### Tests

- `packages/core/test/phase-scope.smoke.js` — new; guards the scope change against accidental revert. Verifies §8.1 does not list Electron desktop, §8.2 lists it with a Phase 2 marker, §39.2 out-of-scope calls it out, §40.12 subsection exists, IMPLEMENTATION_STATUS records the scope change and references §40.12, and desktop/package.json description mentions Phase 2.

## [0.35.0] - 2026-04-22

### Added

**React + CSS Modules wiring + `@xchain-wallet/core/ui` primitives**

Picks the UI framework + styling approach for the Phase 1 UI session. React 18.3 + CSS Modules wins on ecosystem depth (hardware-wallet libs, QR libs, a11y libs) and bundler-native styling (no runtime cost).

**Framework wiring**

- `packages/core/package.json` — `react` / `react-dom` declared as optional peer dependencies (`^18.3.0`). Optional because non-UI code (smoke tests, background handlers) imports `@xchain-wallet/core` without needing React. New `exports` map exposes subpaths so Node-only callers don't trip on JSX reached through the default entry:
    ```
    ".": "./src/index.js"
    "./ui": "./src/ui/index.js"
    "./ui/tokens.css": "./src/ui/tokens.css"
    "./ui/*": "./src/ui/*"
    "./branding/*": "./src/branding/*"
    ```
- `packages/extension/package.json` + `packages/web/package.json` — `react` / `react-dom` as regular deps; `@vitejs/plugin-react@^4.3.0` as a dev dep. Wired at the shell level so each Vite config can opt in to JSX in a later piece.

**Design tokens (§5.4 visual identity, §37 micro-UX)**

- `packages/core/src/ui/tokens.css` — CSS custom properties for spacing (4px grid), typography (system-font stack + monospace), radii, motion (≤200ms, cubic-bezier(0.2, 0, 0.2, 1) per §5.4), and a full palette. Light theme default + `@media (prefers-color-scheme: dark)` overrides. `@media (prefers-reduced-motion: reduce)` disables transitions. Accent colours match `branding.js` ACCENT_PRIMARY / ACCENT_SECONDARY. Shells import once: `import '@xchain-wallet/core/ui/tokens.css'`.

**Primitives (`packages/core/src/ui/`)**

Six components, each a JSX file plus a co-located `.module.css`:

- `<Screen />` — top-level layout wrapper. `variant="popup"` renders fixed 360×600 per §8.1; `variant="full"` flexes for extension full-screen / web SPA. Header / body / footer slots.
- `<Button />` — `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'`, `block`, `loading` (spinner + aria-busy), `disabled`. Focus ring from tokens. Spinner disables under `prefers-reduced-motion`.
- `<Input />` — `forwardRef`'d text input with label, hint, and error slots. `aria-invalid` + `aria-describedby` wired to the matching hint/error nodes via `useId()`. Pass-through props land on the underlying `<input>` so `value` / `onChange` / `autoFocus` / `autoComplete` go directly through.
- `<ChainBadge />` — icon + display name pill. Reads `branding.chainIconSmallUrl(descriptor.id)` for the asset; `descriptor.color` drives the tinted background/border via `color-mix()`. Non-mainnet networks surface the network kind in muted text next to the name.
- `<AddressText />` — monospace address with optional `first6…last6` truncation. Full address preserved via `title` + `aria-label` so hover and AT still expose the canonical string.
- `<CopyButton />` — writes to clipboard via `navigator.clipboard.writeText()`, flips label to "Copied" for 1.5s (configurable via `feedbackMs`). Silent no-op when clipboard is unavailable — callers own the fallback (manual-selection hint, QR).

**`packages/core/src/ui/index.js`** — barrel re-export for the 6 primitives. `tokens.css` stays unreferenced here (it's a global side-effect import shells do once at their entry point).

### Tests

- `packages/core/test/ui-surface.smoke.js` — static check: tokens.css declares the expected 11 custom properties + dark-mode + reduced-motion blocks + brand accent hex matches branding.js; every primitive exports its name, imports its co-located CSS module, references design tokens; `ui/index.js` re-exports all six; `core/package.json` declares the `./ui` + `./ui/tokens.css` subpath exports and `react` / `react-dom` as peerDeps; both shell `package.json`s declare `react` / `react-dom` / `@vitejs/plugin-react`. Runtime JSX smoke lives in the popup piece once a shell bundle compiles it.

## [0.34.0] - 2026-04-22

### Added

**§5 product identity — branding module + chain-icon assets**

- `packages/core/src/branding/branding.js` — single source of truth for user-facing brand strings and asset pointers. Exports `PRODUCT_NAME` (`"XChain Wallet"`), `TAGLINE` (placeholder from §5.2 candidate), `CANONICAL_DOMAIN` (`wallet.xchain.io`), `HOMEPAGE_URL`, `ACCENT_PRIMARY` / `ACCENT_SECONDARY` (sampled from the XChain logo — blue `#1E90C7`, purple `#7B2C8F`), `DEFAULT_EXPLORER_BASE` / `DEFAULT_HUB_BASE`, and chain-icon maps (`CHAIN_ICON_SMALL`, `CHAIN_ICON_LARGE`) keyed by ChainDescriptor.id
- `packages/core/src/branding/assets/` — 20 files vendored from `xchain-explorer/src/content/images/`: product logo (`xchain-color-750.png`), favicon (`favicon.png`), and 9 chain icons × 2 sizes (20px + 500px) covering BTC / DOGE / LTC × mainnet / testnet / regtest
- `assetUrl(filename)` / `logoUrl()` / `faviconUrl()` / `chainIconSmallUrl(chainId)` / `chainIconLargeUrl(chainId)` — resolve asset filenames to runtime URLs via `new URL('./assets/...', import.meta.url)`, the Vite-friendly pattern that emits hashed static assets at build time and still resolves on disk under Node

**§5.5 placeholders — resolved (non-marketing-gated)**

| Item | Resolution |
|---|---|
| Product name | `"XChain Wallet"` |
| Tagline | §5.2 candidate (self-custodial wallet for the XChain Platform) |
| Canonical domain | `wallet.xchain.io` |
| Per-chain explorer/hub URLs | `https://explorer.xchain.io`, `https://hub.xchain.io` (base); existing descriptor entries retained |
| Primary accent | `#1E90C7` (sampled from logo) |
| Secondary accent | `#7B2C8F` (sampled from logo) |
| Logo | `xchain-color-750.png` shipped |
| Favicon | `favicon.png` shipped |
| Chain icons | 9 × 2 sizes shipped |

ADS donation addresses remain the `PLACEHOLDER_REPLACE_BEFORE_MAINNET` sentinel (unchanged — marketing-/ops-gated). Tagline, primary-brand wordmark, and store-listing copy remain pending the marketing pass per §5.5.

### Changed

- `packages/core/src/registry/descriptors/{bitcoin,dogecoin,litecoin}.js` — replaced empty `icon: ''` with per-network asset filenames (e.g. `icon: 'bitcoin-mainnet-icon-20.png'`) on each of the 9 bundled descriptors. Validator JSDoc updated to describe `icon` as an asset filename resolved via `branding.assetUrl()`.
- `packages/extension/src/bridge/handlers.js` — `bridge.getSupportedChains` no longer forwards `descriptor.icon` verbatim to dApps. Raw filenames would be unresolvable cross-origin; a follow-up shell-layer piece will resolve them to `chrome.runtime.getURL(...)` URLs against a web-accessible asset path. Until then the bridge sends `icon: ''` (pre-existing behaviour) with an in-line TODO.

### Tests

- `packages/core/test/branding.smoke.js` — verifies 17 exports, 20 asset files exist on disk, all 9 bundled descriptors validate with their new `icon` fields, and no §5.5 `PLACEHOLDER_` sentinel leaks into branding strings.

## [0.33.0] - 2026-04-22

### Added

**Vite build scaffolding for `extension` and `web` packages** (§9.5 / §51.1) — infrastructure only, no UI framework decisions yet

- `packages/extension/vite.config.js` — multi-entry rollup with three fixed outputs (`background.js`, `content/contentScript.js`, `inject/xchainProvider.js`) matching the paths `manifest.json` already references. Custom `closeBundle` plugin copies `manifest.json` from the package root into `dist/` at build close (keeps the canonical manifest location stable while the UI session adds popup / full-screen HTML). Shared `@xchain-wallet/core` split into its own chunk so the three entries don't duplicate it
- `packages/extension/src/background.js` — MV3 service-worker entry. Builds a `ChainRegistry`, `SDKRegistry` (with a scaffold `throw`-on-use SDK factory — real SDK wires in at build time alongside the popup UI), and lazy-initialises a Vault + MessageHost against `ChromeStorageBackend` + `ChromeSessionBackend`. `attachChromeRuntime(host)` fires once a master key exists in session storage; the popup's unlock flow is responsible for triggering re-init
- `packages/web/vite.config.js` — minimal SPA config. Root `index.html` + `src/main.js` entry that imports `@xchain-wallet/core` and renders a scaffold marker into `#app`, proving the bundler reaches workspace deps. Dev server on port 5173
- `vite@^5.4.0` added as a dev dependency on both packages; build + dev scripts wired (`pnpm -C packages/extension build`, `pnpm -C packages/web build`, `pnpm -C packages/web dev`)
- CI build step enabled: the `install` job now runs `pnpm -r --if-present build` after install, exercising both Vite configs on every PR

### Scope boundary for the UI session

This release is a pipeline prover. No UI framework decision is baked in — the web `main.js` and extension popup/full-screen HTML are deliberately absent so the UI session can pick React / Solid / vanilla / etc. without config churn. What lands when UI work begins: popup HTML entry added to the extension's `rollupOptions.input`, framework runtime added to both packages' devDeps, the scaffold `main.js` replaced wholesale.

## [0.32.0] - 2026-04-22

### Added

**`bridge.parallel` stub** — structured `PHASE_DEFERRED` response so the inject script's `provider.parallel(actions)` surfaces a clean result-shape (`{ error: 'PHASE_DEFERRED', phase: 4, message }`) instead of falling through to `UnknownMessageTypeError`. Matches `bridge.signAction`'s `UNSUPPORTED_ACTION` pattern — dApp authors branch on `result.error` rather than try/catch. Full implementation ships with cross-chain orchestration in Phase 4+.

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
