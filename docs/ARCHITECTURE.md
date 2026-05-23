# XChain Wallet — Architecture

A practical orientation for someone reading this codebase for the first time. For the authoritative design spec, see `claude/reports/xchain-wallet/SPEC.md` in the parent platform repo. For the dApp-developer-facing API reference, see `docs/BRIDGE.md`.

**Scope:** This document covers the wallet repository in isolation. The wider XChain Platform — `xchain-sdk`, `xchain-encoder`, `xchain-decoder`, `xchain-indexer`, `xchain-explorer`, `xchain-hub`, etc. — is documented in the platform README. The wallet consumes `xchain-sdk` as its only data and signing layer.

---

## The three-shell model

The wallet ships three product surfaces from a single React codebase:

| Shell | Form factor | Directory | Storage substrate |
|---|---|---|---|
| Web | Vite SPA at `wallet.xchain.io` (or self-hosted) | `packages/web/` | IndexedDB (vault) + in-memory (session) |
| Extension | Chrome MV3 (popup + full-screen + service worker + content script) | `packages/extension/` | `chrome.storage.local` (vault) + `chrome.storage.session` (session) |
| Desktop | Electron (main + renderer) for Windows / macOS / Linux | `packages/desktop/` | Electron `userData` + OS keychain (session) |

All three render the same React routes from `packages/core/`. Each shell's job is to host the renderer, plug in the right storage and messaging substrate, and (extension + desktop) provide the privileged surfaces that the web shell cannot — service-worker isolation, hardware-signer transports, OS keychain.

---

## Monorepo layout

```
xchain-wallet/
├── packages/
│   ├── core/                shared React routes, components, flows, signers, schemas, SDK glue
│   ├── web/                 Vite SPA shell
│   ├── extension/           Chrome MV3 shell (popup + full-screen + SW + content + inject)
│   ├── desktop/             Electron shell (main + renderer + preload + electron-builder)
│   ├── bridge-spec/         window.xchain TypeScript type definitions (consumed by dApps)
│   └── test-dapp/           reference dApp exercising the bridge
├── test/                    cross-package smokes + Playwright E2E
├── tools/build-reproduce/   reproducible-build helpers
├── docs/                    in-repo architecture / threat-model / dependency notes
└── package.json             workspace root, single source of truth for version
```

`packages/core/` is the bulk of the code. Each shell is intentionally thin — its job is plumbing, not UX.

---

## Package boundaries

### `@xchain-wallet/core`

The wallet's brain. Subdirectories:

- `flows/` — high-level user actions as plain async functions: `createWallet`, `importMnemonic`, `sendAction`, `signMessageAction`, `revealMnemonic`, `publishLabelsNow`, etc. Each flow takes a context object, runs validation + business logic, and returns a result. Flows do not import from a shell.
- `signers/` — `SoftwareSigner`, `TrezorSigner`, `LedgerSigner`, `RemoteSigner`, `MultisigSigner`. All implement the same `Signer` interface (`sign`, `signPsbt`, `signMessage`, `getAddress`, `getXpub`).
- `signerFactories/` — per-shell construction wiring (HW signers need different transports per shell).
- `schemas/` — vault schema, version migrations, validators.
- `crypto/` — Argon2id + AES-256-GCM + ECIES + commitment-key helpers wrapping `@noble/hashes` / `@noble/ciphers`.
- `decoder/` — turns a PSBT or ACTION payload into the plain-English summary the sign screen renders.
- `storage/` — abstract storage interface; each shell provides a concrete implementation via `hostBridge`.
- `shared/` — React components and routes (the actual UI). Subdivides into `components/`, `routes/`, `hooks/`, `i18n`, `ui` (design-token primitives).
- `sdk/` — thin wrappers around `xchain-sdk` calls, batched and cached per chain.
- `registry/` — `chainRegistry` of `ChainDescriptor` records (RPC endpoints, explorer URLs, native asset metadata).
- `uri/` — URI scheme parsing (`bitcoin:`, `dogecoin:`, `litecoin:`, `xchain:`, BIP21).
- `templates/` — cross-chain action templates (parallel composer, swap pairs).
- `index.js` + `buildInfo.js` — public entry. Versioning lives in `buildInfo.WALLET_VERSION`.

### `@xchain-wallet/extension`

- `background/` — MV3 service worker: vault host, approval broker, dApp bridge handlers, signer pool, reachability poller.
- `popup/` — popup UI (mounts core React routes against a popup-shaped container).
- `inject/` — the `window.xchain` provider script injected into every page that opts in.
- `content/` — content-script bridge between the page (`postMessage`) and the service worker (`chrome.runtime.sendMessage`).
- `approval/` — popup window that mediates user approvals for dApp-initiated signing requests.
- `signers/` — extension-flavored HW signer transports (Trezor Connect popup, Ledger WebHID).

### `@xchain-wallet/web`

- `App.jsx` — top-level route switch.
- `hostBridge.js` — implements the same `messaging` interface the extension's background does, but in-process. Vault lives in IndexedDB; session keys live in memory.
- `messaging.js` — shim that the core React tree consumes.
- A handful of dev-mode helpers (`devFakeBalances.js`, `DevVariantBadge.jsx`).

### `@xchain-wallet/desktop`

- `main/` — Electron main process: vault host, signer pool (with WebHID HW transports), OS-keychain integration, deep-link / protocol handler registration, single-instance lock.
- `renderer/` — Vite-built React tree (mounts the same core routes).
- `preload.js` — context-isolated bridge between renderer and main; exposes only the messaging surface.

### `@xchain-wallet/bridge-spec`

TypeScript type definitions for `window.xchain`. Consumed by dApps via `import type { XchainProvider } from '@xchain-wallet/bridge-spec'`. Method names + payload shapes are normative.

### `@xchain-wallet/test-dapp`

A reference page that calls every bridge method. Used as a manual + smoke harness against the real extension during development.

---

## Signal flow

A user action moves through four layers:

```
React component (packages/core/src/shared/routes/Send.jsx)
        │
        ▼   uses hooks like useMessaging() / useVault()
flow function (packages/core/src/flows/sendAction.js)
        │
        ▼   calls messaging.<method>(args)
host bridge (per-shell):
  • web      → packages/web/src/hostBridge.js (in-process)
  • extension→ chrome.runtime.sendMessage → packages/extension/src/background/handlers/*
  • desktop  → ipcRenderer.invoke → packages/desktop/main/handlers/*
        │
        ▼   reads/writes vault, calls SDK, drives signer pool
xchain-sdk → coin node / hub / explorer / encoder / decoder
```

Three rules govern this flow:

1. **Components never read the vault directly.** They go through `messaging.*` (a thin async API) which is implemented by the shell's host bridge.
2. **Flows never import from a shell.** They take a messaging-shaped argument and remain shell-agnostic, which is what makes the same React tree renderable in three different processes.
3. **The host bridge is the only thing that touches private keys.** In the extension, that's the service worker; in desktop, that's the main process; in web, it's an in-process module that's still firewalled from the React tree by the messaging interface.

The rules give the wallet two properties that matter for security:

- The extension service worker can be hardened against the popup (key material never crosses the message boundary in plaintext).
- The desktop main process can hold HW transports and the OS keychain without the renderer ever seeing them.

---

## Signer abstraction

Every signer implements:

```js
interface Signer {
  source: 'software' | 'trezor' | 'ledger' | 'remote' | 'multisig';
  getAddress(opts) → Promise<string>;
  getXpub(opts) → Promise<string>;
  signPsbt(psbtHex, signingPath) → Promise<signedPsbtHex>;
  signMessage(message, signingPath) → Promise<{ signature, address }>;
}
```

Concrete implementations live in `packages/core/src/signers/`. Construction differs per shell because hardware transports are shell-specific (popup-driven Trezor Connect in the extension, WebHID in desktop, etc.) — `signerFactories/` holds the per-shell wiring.

`MultisigSigner` is composite: it orchestrates n-of-m round-trips via PSBT-QR or paste-inbox transport, ultimately delegating to per-cosigner signers underneath.

The sign path always routes through the host bridge so the signer pool can authenticate the calling context (popup vs. dApp vs. user-initiated).

---

## Storage substrate

Each shell maps the same logical schema onto a different physical store:

| Logical store | Web | Extension | Desktop |
|---|---|---|---|
| Vault (encryptedSeed, accounts, addresses, contacts, settings, connectedSites) | IndexedDB `xc-vault` | `chrome.storage.local` | Electron `userData/vault` |
| Session (master key after unlock) | in-memory only | `chrome.storage.session` (cleared on browser close) | OS keychain (with consent) or in-memory |
| Ephemeral metadata (toast state, demo flag, last-view) | `localStorage` | `localStorage` | `localStorage` |

The vault payload is AES-256-GCM-encrypted with a key derived from the user's password via Argon2id. See `docs/Threat_Model.md` for the full posture.

---

## dApp bridge architecture

A dApp that wants to interact with the wallet does so through `window.xchain`:

```
dApp page                    window.xchain (provider)
   │
   │ postMessage('xchain.req', payload)
   ▼
content script (extension)   relays req → background
   │
   ▼
service worker:
  • bridge handler decodes req
  • routes to approval broker if user consent needed
  • approval broker opens a popup window; user reviews + approves
  • broker invokes the right flow / signer
   │
   ▼
content script relays res → page → provider resolves the Promise
```

For the web shell (no extension installed), the same provider can be served as a fallback that messages the SPA itself — limited because no service-worker isolation exists, but covers read-only methods + sign requests where the user is already in the wallet.

The bridge surface (method names, payload shapes, error codes, event types) is normative in `@xchain-wallet/bridge-spec`. See `docs/BRIDGE.md` for the dApp-developer-facing reference.

---

## Approval broker

User-facing approval popups are mediated by the approval broker (`packages/extension/src/approval/`). Every privileged request — signMessage, signPsbt, signAction, connect, disconnect — parks itself in the broker; the broker opens a real `chrome.windows.create({ type: 'popup' })` window with its own origin (`chrome-extension://<id>/approval.html`); the popup fetches the parked request via `approval.fetch({ id })` and renders the appropriate review screen; user accept resolves the request, user reject (or window-close) rejects it.

Window-close = user-rejected by spec §43.4. A closed approval window can never consent.

---

## Reachability and offline mode

The host bridge polls the configured RPC endpoints periodically (`reachability.check`). Each chain falls into one of three states: `normal`, `degraded` (intermittent), `offline`. The React tree subscribes via `useReachability`; surfaces that depend on live data render staleness labels and (offline-class events) fall back to a queued-broadcast lane (`packages/core/src/flows/queuedBroadcast.js`).

---

## Versioning and synchronized release

All workspace packages — root, `core`, `web`, `extension`, `desktop`, `bridge-spec`, `test-dapp` — ship at the same version. The root `package.json` is the source of truth; sub-packages track in lockstep. `packages/core/src/buildInfo.js → WALLET_VERSION` is bumped alongside every release so the About panel and diagnostic dump can both surface a build-tag without reaching back through the import graph.

`CHANGELOG.md` at the repo root is authoritative. Sub-packages do not maintain their own changelogs.

---

## Where to read next

- `docs/Threat_Model.md` — what we defend against, what we don't, why.
- `docs/BRIDGE.md` — `window.xchain` API reference for dApp developers.
- `docs/DEPENDENCIES.md` — per-package "why we depend on this" + audit cadence.
- `CONTRIBUTING.md` — dev setup, tests, versioning, PR conventions.
- `SECURITY.md` — private vulnerability disclosure path.
- `claude/reports/xchain-wallet/SPEC.md` (in the parent platform repo) — the authoritative design specification.

---

Last reviewed: 2026-04-27 at v0.197.0.
