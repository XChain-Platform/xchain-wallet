// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop main-process listener for the signer-bridge ipc channel.
// Mirrors the extension `signerBridgeListener.js` pattern — accepts
// renderer connections, builds a transport for each connection, and
// populates the signerBridge registry so `action.*.hw` handlers can
// reach the renderer-hosted Trezor/Ledger signers.
//
// Extension ports vs Electron ipc: chrome.runtime gives us a per-port
// lifecycle with `onMessage` + `onDisconnect`. Electron ipc is a
// singleton ipcMain event stream with no connection concept — every
// message arrives with an `event.sender` (the BrowserWindow's
// webContents) that we key a synthetic "port" off of. First message
// from a given webContents creates the entry; when the webContents
// is destroyed (window closed, navigation, renderer crash) we tear
// down the transport + clear its owned signerIds so pending sign
// requests reject with "signer bridge disconnected" instead of
// hanging forever.
//
// Desktop ships single-window today, but per-webContents keying
// keeps multi-window safe when a future step lands it.

// Cross-package relative paths keep this module importable under
// plain Node (for smoke tests) without depending on the pnpm
// workspace symlink. Vite + electron-builder follow both paths at
// build time. Same convention as main/messageHost.js.
import { createBackgroundTransport } from '../../core/src/signers/index.js';
// The extension package owns the process-wide signer-bridge registry;
// `createBackgroundHost` (which desktop's MessageHost reuses) imports
// from the same module, so registering here reaches the
// `action.*.hw` dispatch path.
import * as signerBridge from '../../extension/src/background/signerBridge.js';

export const SIGNER_BRIDGE_CHANNEL = 'xchain-wallet:signer-bridge';

/**
 * Attach the main-process signer-bridge listener. Returns a detach
 * function for tests + hot reload.
 *
 * @param {Object} opts
 * @param {{ on: Function, off: Function }} opts.ipcMain
 * @param {string} [opts.channel]
 * @returns {() => void}
 */
export function attachSignerBridgeListener({ ipcMain, channel = SIGNER_BRIDGE_CHANNEL }) {
    if (!ipcMain || typeof ipcMain.on !== 'function') {
        throw new Error('attachSignerBridgeListener: ipcMain.on is required');
    }
    /** @type {Map<number, { port: any, ownedIds: Set<string>, listeners: Set<(msg:any)=>void>, disconnectListeners: Set<()=>void> }>} */
    const bySender = new Map();

    const onIpc = (event, msg) => {
        const sender = event?.sender;
        if (!sender) return;
        const id = sender.id;
        let entry = bySender.get(id);
        if (!entry) entry = createEntryFor(sender);
        // Fan out to every listener bound on the port. In practice
        // there are two: `createBackgroundTransport`'s response
        // correlator and our register/unregister handler.
        for (const fn of entry.listeners) {
            try { fn(msg); } catch { /* swallow listener errors */ }
        }
    };

    function createEntryFor(sender) {
        /** @type {Set<(msg:any)=>void>} */
        const listeners = new Set();
        /** @type {Set<()=>void>} */
        const disconnectListeners = new Set();
        const port = {
            postMessage(msg) {
                if (sender.isDestroyed?.()) return;
                try { sender.send(channel, msg); } catch { /* destroyed mid-send */ }
            },
            onMessage: {
                addListener: (fn) => listeners.add(fn),
                removeListener: (fn) => listeners.delete(fn),
            },
            onDisconnect: {
                addListener: (fn) => disconnectListeners.add(fn),
                removeListener: (fn) => disconnectListeners.delete(fn),
            },
        };
        const transport = createBackgroundTransport(port);
        /** @type {Set<string>} */
        const ownedIds = new Set();

        listeners.add((msg) => {
            if (!msg) return;
            if (msg.kind === 'register' && Array.isArray(msg.signerIds)) {
                for (const sid of msg.signerIds) {
                    if (typeof sid !== 'string' || sid.length === 0) continue;
                    signerBridge.setTransport(sid, transport);
                    ownedIds.add(sid);
                }
            } else if (msg.kind === 'unregister' && Array.isArray(msg.signerIds)) {
                for (const sid of msg.signerIds) {
                    if (!ownedIds.has(sid)) continue;
                    signerBridge.clearTransport(sid);
                    ownedIds.delete(sid);
                }
            }
        });

        const tearDown = () => {
            for (const fn of disconnectListeners) {
                try { fn(); } catch { /* swallow */ }
            }
            for (const sid of ownedIds) signerBridge.clearTransport(sid);
            ownedIds.clear();
            bySender.delete(sender.id);
        };
        try {
            sender.once?.('destroyed', tearDown);
        } catch { /* non-Electron shim (test fake) */ }

        const entry = { port, ownedIds, listeners, disconnectListeners };
        bySender.set(sender.id, entry);
        return entry;
    }

    ipcMain.on(channel, onIpc);
    return function detach() {
        try { ipcMain.off(channel, onIpc); } catch { /* ignore */ }
        for (const entry of bySender.values()) {
            for (const fn of entry.disconnectListeners) {
                try { fn(); } catch { /* swallow */ }
            }
            for (const sid of entry.ownedIds) signerBridge.clearTransport(sid);
        }
        bySender.clear();
    };
}
