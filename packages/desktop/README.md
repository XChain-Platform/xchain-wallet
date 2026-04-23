# @xchain-wallet/desktop

**Phase 2 — in progress.**

Electron desktop shell for XChain Wallet. Main-process signing isolation
(§9.3.2) scaffold landed at v0.55.0 (Step 16). Native hardware transports
and packaging follow in Steps 17–19.

## Architecture

Two processes (§9.3.2):

- **Main process** (`main/`) owns the Vault, the SDK instance, and all
  signers. Keys never cross the IPC boundary into the renderer. Reuses
  the same `createBackgroundHost` factory the extension service worker
  uses — the wallet's flows, handlers, and error envelopes are
  identical across shells.
- **Renderer process** (`renderer/`) runs the same React app from
  `@xchain-wallet/core`. Talks to main via preload-exposed
  `window.xchainWalletBridge.sendMessage(message)`.

```
Electron main
  Vault (file-backed, encrypted)
     ↑
  createBackgroundHost(deps)
     ↑
  MessageHost.handle(message)
     ↑
  ipcMain.handle('xchain-wallet:message', …)

preload.js
  contextBridge.exposeInMainWorld(
    'xchainWalletBridge',
    { sendMessage(message) { … } },
  )

Electron renderer
  messaging.js (popup/web parity helpers)
     ↑
  React app — same shared routes as popup + web
```

## Step 16 — what's in place

- `main/index.js` — Electron entry. `app.whenReady` → vault init + IPC
  wiring + BrowserWindow creation. `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`.
- `main/storage.js` — `FileStorageBackend` for the encrypted vault blob
  under `app.getPath('userData')/vault.bin`. Atomic writes (write to
  `.tmp`, rename into place).
- `main/messageHost.js` — `createDesktopMessageHost(deps)` — thin
  adapter around `createBackgroundHost` so Step 17 (OS keychain) and
  Step 18 (native HW transports) hook into the same host surface the
  extension uses.
- `preload.js` — exposes exactly `window.xchainWalletBridge.sendMessage`
  and nothing else.
- `renderer/main.jsx` + `renderer/App.jsx` — mounts the shared React
  app under `shell="desktop"`. Every route from popup/web renders
  unchanged.
- `renderer/bridgeMessaging.js` + `renderer/messaging.js` — bridge
  wrapper + popup/web parity helpers.

## Step 16 — what's NOT here yet

- **OS keychain integration** (Step 17) — Electron `safeStorage` wired
  into the unlock flow so users don't enter their password every launch.
- **Native HW transports** (Step 18) — `@trezor/connect` (node) and
  `@ledgerhq/hw-transport-node-hid` wired into desktop-specific
  `pairTrezorSigner` / `pairLedgerSigner` factories. Until then,
  PairSignerForm in the desktop renderer shows "not available in this
  context" for both vendors.
- **electron-builder packaging** (Step 19) — Windows Authenticode,
  macOS notarization, Linux AppImage/deb/rpm. Also URI scheme
  registration for `xchain:` + `bitcoin:` / `dogecoin:` / `litecoin:`.

## Running in dev

Not yet wired for live runs — the package declares `electron` as a
devDep but launching requires `pnpm install` (which pulls Electron's
~200 MB bundle). Until Step 19's packaging pipeline lands, the
recommended way to exercise the desktop code path is via the
`desktop-shell.smoke.js` smoke (static wiring + storage round-trip
against the file backend).

## Why Phase 2 is the right time

The desktop shell's headline differentiators over extension + web are:

- **OS keychain integration** (macOS Keychain, Windows Credential
  Manager, libsecret) — Step 17.
- **Native USB/HID hardware-wallet transports** — Step 18.

Both need the Phase 2 hardware-signer work (`TrezorSigner` /
`LedgerSigner`, shipped at v0.53.0).
