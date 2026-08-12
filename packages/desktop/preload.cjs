// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Electron preload: the single bridge between renderer and main.
//
// §9.3.2: "keys never cross the contextBridge IPC boundary into the
// renderer." This preload upholds that by exposing exactly three narrow
// APIs via contextBridge. Nothing about Node, the filesystem, Electron
// internals, or native modules is exposed to the renderer.
//
//   - `xchainWalletBridge.sendMessage(message)`: request/response for
//     every MessageHost call (unlock, sendToken, etc.). Mirrors the
//     extension popup + web shell wire format.
//
//   - `xchainWalletBridge.wipeStorage()`: . The shared
//     `wipeWalletStorage` helper can only reach localStorage +
//     IndexedDB, and this shell keeps its vault, kdfParams meta,
//     session key and unlock throttle in files under userData. Without
//     this call the demo exit and the Locked "forgot password" wipe are
//     silent no-ops. Deliberately takes no arguments: the renderer says
//     "wipe", main decides what that means, so a compromised renderer
//     cannot aim it at an arbitrary path.
//
//   - `xchainWalletSignerBridge.{postMessage,onMessage,onDisconnect}`:
//     duplex port for the hardware-signer RPC. Renderer-hosted
//     Trezor/Ledger signers expose their status + sign methods back
//     to the main process over this channel. Shaped as a neutral
//     {postMessage, onMessage} adapter so the desktop renderer +
//     main reuse the same `signerPortProtocol` helpers the extension
//     uses over `chrome.runtime.connect` ports.
//
//   - `xchainWalletWindow.openDetached({ initialView, initialContext })`:
//     §24.6 / Cluster Y FOLLOWUP 4 detach-pending-tx. The renderer
//     asks main to spawn a fresh BrowserWindow pre-routed to the
//     specified view + context (e.g. a pending tx detail).
//
//   - `xchainWalletRegistry.getRemoteDescriptors()`: §9.7 / G007
//     chain-registry sync. The renderer CSP pins connect-src 'self',
//     so main performs the hub fetch + Ed25519 verification and the
//     renderer pulls the verified descriptor batch through this call
//     to hot-swap its own registry realm.

// CommonJS on purpose: Electron loads sandboxed preloads (webPreferences
// sandbox: true) through its CJS wrapper, so an ESM `import` here throws
// "Cannot use import statement outside a module" and NO bridge gets
// exposed. The package's "type": "module" makes plain .js files ESM,
// hence the .cjs extension. `require('electron')` is the only module a
// sandboxed preload may pull in.
const { contextBridge, ipcRenderer } = require('electron');

const MESSAGE_CHANNEL = 'xchain-wallet:message';
const SIGNER_BRIDGE_CHANNEL = 'xchain-wallet:signer-bridge';
const OPEN_WINDOW_CHANNEL = 'xchain:open-window';
const WIPE_STORAGE_CHANNEL = 'xchain:wipe-storage';
const CHAIN_REGISTRY_CHANNEL = 'xchain:chain-registry';
const UPDATER_EVENT_CHANNEL = 'xchain:updater';
const UPDATER_INSTALL_CHANNEL = 'xchain:updater-install';

contextBridge.exposeInMainWorld('xchainWalletBridge', {
    /**
     * @param {{ type: string, request?: unknown }} message
     * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string } }>}
     */
    sendMessage(message) {
        return ipcRenderer.invoke(MESSAGE_CHANNEL, message);
    },
    /**
     * Clear every wallet store this shell owns under userData (vault
     * blob, kdfParams meta, cached session key, unlock throttle) and
     * drop the in-memory host. `{ ok: false, error }` means at least
     * one store survived, and the caller must surface that rather than
     * reload into a stale unlock screen.
     * @returns {Promise<{ ok: true, cleared: string[] } | { ok: false, cleared?: string[], error: string }>}
     */
    wipeStorage() {
        return ipcRenderer.invoke(WIPE_STORAGE_CHANNEL);
    },
});

contextBridge.exposeInMainWorld('xchainWalletWindow', {
    /**
     * Ask main to open a fresh BrowserWindow pre-routed to the given
     * view + context. Used by §24.6 detach-pending-tx and any future
     * "Open in new window" affordance.
     * @param {{ initialView?: string, initialContext?: any }} args
     * @returns {Promise<{ ok: true, windowId: number } | { ok: false, error: string }>}
     */
    openDetached(args) {
        return ipcRenderer.invoke(OPEN_WINDOW_CHANNEL, args);
    },
});

// The update bridge ( row 140/142).
//
// WHAT WAS MISSING, AND IT WAS THE WHOLE LAST MILE. main/index.js has
// broadcast `xchain:updater` events since the updater was wired, and
// under `contextIsolation: true` a renderer cannot call `ipcRenderer.on`,
// so nothing could ever receive them: the channel had one writer and no
// possible reader. `downloadAndInstall()` in main/updater.js - the only
// path to an installed update, and the one that runs the S5 signature
// gate before it calls `quitAndInstall` - had no caller anywhere in the
// repo. So the shipped desktop wallet checked for updates on launch,
// told no one, and could not install one. Both halves are exposed here.
contextBridge.exposeInMainWorld('xchainWalletUpdater', {
    /**
     * Subscribe to updater events: `available`, `verifying`, `rejected`,
     * `error`, `downloaded`. Returns an unsubscribe.
     * @param {(event: {type: string, info?: any}) => void} listener
     * @returns {() => void}
     */
    onEvent(listener) {
        const wrapped = (_event, payload) => { listener(payload); };
        ipcRenderer.on(UPDATER_EVENT_CHANNEL, wrapped);
        return () => ipcRenderer.removeListener(UPDATER_EVENT_CHANNEL, wrapped);
    },
    /**
     * Download the offered update, verify it against the K1-signed
     * release manifest, and install it. The app quits and relaunches on
     * success, so a resolved `{ ok: true }` is rarely observed.
     * @returns {Promise<{ ok: boolean, reason?: string }>}
     */
    install() {
        return ipcRenderer.invoke(UPDATER_INSTALL_CHANNEL);
    },
});

contextBridge.exposeInMainWorld('xchainWalletRegistry', {
    /**
     * Fetch the signature-verified remote chain-registry batch main
     * applied at boot (awaits the in-flight sync, so callers never
     * race it). `{ ok: false, reason }` means the sync failed or was
     * skipped and the bundled descriptors should keep serving.
     * @returns {Promise<{ ok: true, descriptors: object[], generatedAt?: string } | { ok: false, reason?: string }>}
     */
    getRemoteDescriptors() {
        return ipcRenderer.invoke(CHAIN_REGISTRY_CHANNEL);
    },
});

contextBridge.exposeInMainWorld('xchainWalletSignerBridge', {
    /**
     * Renderer → main. Fire-and-forget; the reply (when one is
     * warranted) arrives on the `onMessage` stream.
     * @param {any} msg
     */
    postMessage(msg) {
        ipcRenderer.send(SIGNER_BRIDGE_CHANNEL, msg);
    },
    /**
     * Subscribe to main → renderer messages. Returns an unsubscribe.
     * @param {(msg: any) => void} listener
     * @returns {() => void}
     */
    onMessage(listener) {
        const wrapped = (_event, msg) => { listener(msg); };
        ipcRenderer.on(SIGNER_BRIDGE_CHANNEL, wrapped);
        return () => ipcRenderer.removeListener(SIGNER_BRIDGE_CHANNEL, wrapped);
    },
});
