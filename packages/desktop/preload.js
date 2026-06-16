// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Electron preload — the single bridge between renderer and main.
//
// §9.3.2: "keys never cross the contextBridge IPC boundary into the
// renderer." This preload upholds that by exposing exactly three narrow
// APIs via contextBridge. Nothing about Node, the filesystem, Electron
// internals, or native modules is exposed to the renderer.
//
//   - `xchainWalletBridge.sendMessage(message)` — request/response for
//     every MessageHost call (unlock, sendToken, etc.). Mirrors the
//     extension popup + web shell wire format.
//
//   - `xchainWalletSignerBridge.{postMessage,onMessage,onDisconnect}`
//     — duplex port for the hardware-signer RPC. Renderer-hosted
//     Trezor/Ledger signers expose their status + sign methods back
//     to the main process over this channel. Shaped as a neutral
//     {postMessage, onMessage} adapter so the desktop renderer +
//     main reuse the same `signerPortProtocol` helpers the extension
//     uses over `chrome.runtime.connect` ports.
//
//   - `xchainWalletWindow.openDetached({ initialView, initialContext })`
//     — §24.6 / Cluster Y FOLLOWUP 4 detach-pending-tx. The renderer
//     asks main to spawn a fresh BrowserWindow pre-routed to the
//     specified view + context (e.g. a pending tx detail).

import { contextBridge, ipcRenderer } from 'electron';

const MESSAGE_CHANNEL = 'xchain-wallet:message';
const SIGNER_BRIDGE_CHANNEL = 'xchain-wallet:signer-bridge';
const OPEN_WINDOW_CHANNEL = 'xchain:open-window';

contextBridge.exposeInMainWorld('xchainWalletBridge', {
    /**
     * @param {{ type: string, request?: unknown }} message
     * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string } }>}
     */
    sendMessage(message) {
        return ipcRenderer.invoke(MESSAGE_CHANNEL, message);
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
