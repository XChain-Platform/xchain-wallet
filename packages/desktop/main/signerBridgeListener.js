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
// Mirrors the extension `signerBridgeListener.js` pattern: accepts
// renderer connections, builds a transport for each connection, and
// populates the signerBridge registry so `action.*.hw` handlers can
// reach the renderer-hosted Trezor/Ledger signers.
//
// Extension ports vs Electron ipc: chrome.runtime gives us a per-port
// lifecycle with `onMessage` + `onDisconnect`. Electron ipc is a
// singleton ipcMain event stream with no connection concept; every
// message arrives with an `event.sender` (the BrowserWindow's
// webContents) that we key a synthetic "port" off of. First message
// from a given webContents creates the entry; when the webContents
// is destroyed (window closed, navigation, renderer crash) we tear
// down the transport + clear its owned signerIds so pending sign
// requests reject with "signer bridge disconnected" instead of
// hanging forever.
//
// Trust boundary (parallels the extension's isTrustedExtensionSender
// gate): the process-wide signerBridge registry is a plain Map keyed by
// signerId with last-writer-wins semantics. Three guards keep a second
// (or hostile) webContents from hijacking another window's hardware
// signer:
//
//   1. `isTrustedSender(event)` rejects any frame index.js can identify
//      as a non-local origin (belt-and-suspenders behind the window
//      navigation lockdown).
//   2. A signerId->ownerSenderId map refuses to re-point a signerId that
//      a DIFFERENT, still-live webContents already owns. Re-registration
//      from the same sender (or after the prior owner tore down) is
//      allowed. This is what actually stops the cross-window reroute:
//      without it, window B could `register` window A's signerId and
//      every getAddresses/signPsbt for that id would flow to B.
//   3. A per-message signerIds cap bounds registry growth from a
//      misbehaving/compromised renderer.
//   4. A per-sender CUMULATIVE cap bounds it across messages. Guard 3
//      alone bounds one message and nothing else, so N valid messages
//      retained 64*N transports: 100 messages is 6,400 live entries in
//      `transports`, `ownedIds` and `ownerBySignerId`, none of which any
//      teardown reaches while the sender stays alive.

import { createBackgroundTransport } from '@xchain-wallet/core/signers';
// The extension package owns the process-wide signer-bridge registry;
// `createBackgroundHost` (which desktop's MessageHost reuses) imports
// from the same module, so registering here reaches the
// `action.*.hw` dispatch path.
import * as signerBridge from '@xchain-wallet/extension/src/background/signerBridge.js';

export const SIGNER_BRIDGE_CHANNEL = 'xchain-wallet:signer-bridge';

// A single renderer legitimately registers one id per paired HW signer;
// a handful of devices is the realistic ceiling. Anything past this in a
// single message is a misbehaving or hostile sender, so drop it.
export const MAX_SIGNER_IDS_PER_MESSAGE = 64;

// Same ceiling, applied across every message a single webContents ever
// sends rather than to one message. Re-registering an id already owned
// costs nothing, and `unregister` (or window teardown) returns capacity,
// so a real renderer with a handful of paired devices never meets it.
export const MAX_SIGNER_IDS_PER_SENDER = 64;

/**
 * Attach the main-process signer-bridge listener. Returns a detach
 * function for tests + hot reload.
 *
 * @param {Object} opts
 * @param {{ on: Function, off: Function }} opts.ipcMain
 * @param {string} [opts.channel]
 * @param {(event: any) => boolean} [opts.isTrustedSender]  reject a frame
 *        index.js identifies as a remote origin; defaults to accept-all so
 *        the pure unit harness (fake senders with no URL) is unaffected.
 * @param {number} [opts.maxSignerIdsPerMessage]
 * @param {number} [opts.maxSignerIdsPerSender]  cumulative cap on the ids one
 *        webContents may hold at once; freed by unregister and teardown.
 * @returns {() => void}
 */
export function attachSignerBridgeListener({
    ipcMain,
    channel = SIGNER_BRIDGE_CHANNEL,
    isTrustedSender = () => true,
    maxSignerIdsPerMessage = MAX_SIGNER_IDS_PER_MESSAGE,
    maxSignerIdsPerSender = MAX_SIGNER_IDS_PER_SENDER,
}) {
    if (!ipcMain || typeof ipcMain.on !== 'function') {
        throw new Error('attachSignerBridgeListener: ipcMain.on is required');
    }
    /** @type {Map<number, { port: any, ownedIds: Set<string>, listeners: Set<(msg:any)=>void>, disconnectListeners: Set<()=>void> }>} */
    const bySender = new Map();
    // signerId -> the sender.id that currently owns its transport. Guards
    // against a second webContents silently overwriting the mapping.
    /** @type {Map<string, number>} */
    const ownerBySignerId = new Map();

    const onIpc = (event, msg) => {
        const sender = event?.sender;
        if (!sender) return;
        // Trust boundary: drop messages from a frame identified as remote.
        if (!isTrustedSender(event)) return;
        let entry = bySender.get(sender.id);
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
                // Cap the batch: a legitimate renderer registers a handful
                // of ids; an over-cap message is a misbehaving/hostile
                // sender and is dropped whole rather than partially applied.
                if (msg.signerIds.length > maxSignerIdsPerMessage) return;
                // Cumulative quota: count the ids this message would ADD
                // (already-owned ids are free re-points, and ids another
                // live sender owns are dropped below anyway) and refuse
                // the whole message if the sender cannot hold them all.
                // Whole-message, not partial, to match the batch cap above.
                const adds = new Set();
                for (const sid of msg.signerIds) {
                    if (typeof sid !== 'string' || sid.length === 0) continue;
                    if (ownedIds.has(sid)) continue;
                    const holder = ownerBySignerId.get(sid);
                    if (holder !== undefined && holder !== sender.id && bySender.has(holder)) {
                        continue;
                    }
                    adds.add(sid);
                }
                if (ownedIds.size + adds.size > maxSignerIdsPerSender) return;
                for (const sid of msg.signerIds) {
                    if (typeof sid !== 'string' || sid.length === 0) continue;
                    // Ownership guard: never re-point a signerId a different,
                    // still-live webContents already owns.
                    const owner = ownerBySignerId.get(sid);
                    if (owner !== undefined && owner !== sender.id && bySender.has(owner)) {
                        continue;
                    }
                    signerBridge.setTransport(sid, transport);
                    ownedIds.add(sid);
                    ownerBySignerId.set(sid, sender.id);
                }
            } else if (msg.kind === 'unregister' && Array.isArray(msg.signerIds)) {
                for (const sid of msg.signerIds) {
                    if (!ownedIds.has(sid)) continue;
                    signerBridge.clearTransport(sid);
                    ownedIds.delete(sid);
                    if (ownerBySignerId.get(sid) === sender.id) ownerBySignerId.delete(sid);
                }
            }
        });

        const tearDown = () => {
            for (const fn of disconnectListeners) {
                try { fn(); } catch { /* swallow */ }
            }
            for (const sid of ownedIds) {
                signerBridge.clearTransport(sid);
                if (ownerBySignerId.get(sid) === sender.id) ownerBySignerId.delete(sid);
            }
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
        ownerBySignerId.clear();
    };
}
