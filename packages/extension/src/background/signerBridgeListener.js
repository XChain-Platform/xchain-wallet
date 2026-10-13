// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Background-side listener for the signer bridge port. Accepts
// long-lived `chrome.runtime.connect({ name: 'signer-bridge' })`
// connections from the popup / full-screen UI, builds a transport
// function for each port, and populates `signerBridge` with
// transports keyed by each signerId the renderer announces.
//
// Ports are many-per-renderer (each open popup tab maintains its
// own port). If two renderers both register the same signerId, the
// latest registration wins. Signing will route to whichever
// renderer the user most recently interacted with. Disconnect or
// unregister clears only the ids whose registered transport is still
// this port's own, so a superseded port never clears a newer page's.

import { signers } from '@xchain-wallet/core';
import * as signerBridge from './signerBridge.js';
import { isTrustedExtensionSender } from '../bridge/publicSurface.js';

const { createBackgroundTransport } = signers;

// Most ids one `register` message may carry. A renderer announces the
// hardware signers it holds live, which is a handful; the desktop
// listener caps the same message at the same number.
export const MAX_SIGNER_IDS_PER_MESSAGE = 64;

// Most ids one port may hold across all its messages, matching desktop's
// MAX_SIGNER_IDS_PER_SENDER (the per-message cap alone lets N messages keep
// 64*N transports). Owned ids re-register free; unregister and disconnect free room.
export const MAX_SIGNER_IDS_PER_SENDER = 64;

// Count only the valid ids this port does not already own. An id a newer page
// took over still counts until this port unregisters it or disconnects.
function fitsPortQuota(ownedIds, signerIds) {
    const adds = new Set();
    for (const id of signerIds) {
        if (typeof id === 'string' && id.length > 0 && !ownedIds.has(id)) adds.add(id);
    }
    return ownedIds.size + adds.size <= MAX_SIGNER_IDS_PER_SENDER;
}

/**
 * Attach the signer-bridge onConnect listener. Returns a detach
 * function for tests + hot reload.
 *
 * @param {{ onConnect: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void}
 */
export function attachSignerBridgeListener(chromeRuntime) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onConnect) {
        throw new Error(
            'attachSignerBridgeListener: chrome.runtime.onConnect is not available',
        );
    }

    const listener = (port) => {
        if (!port || port.name !== 'signer-bridge') return;
        // Trust boundary: only the extension's own UI may register a HW
        // signer transport. A web page can also open a port, and without
        // this check it could register itself as the transport for a
        // signerId and hijack/observe hardware-signing traffic. Reject
        // (disconnect) any connection that is not from an extension page.
        if (!isTrustedExtensionSender(port.sender, runtime.id)) {
            try { port.disconnect?.(); } catch (_err) { /* best-effort */ }
            return;
        }
        const transport = createBackgroundTransport(port);
        /** @type {Set<string>} */
        const ownedIds = new Set();

        const onMessage = (msg) => {
            if (!msg) return;
            if (msg.kind === 'register' && Array.isArray(msg.signerIds)) {
                // Drop an over-cap batch whole rather than applying part of
                // it: a legitimate renderer announces a handful of ids, so an
                // oversized message is a bug or a misbehaving page and half a
                // registry is worse than none.
                if (msg.signerIds.length > MAX_SIGNER_IDS_PER_MESSAGE) return;
                // Drop the whole batch when it would push this port past its total cap.
                if (!fitsPortQuota(ownedIds, msg.signerIds)) return;
                // No cross-owner guard here, unlike the desktop twin, and that
                // is deliberate: isTrustedExtensionSender collapses popup,
                // full-screen tab and side panel to ONE trust level, and the
                // newest page is the one the user is looking at, so it must be
                // able to take over signing from a still-open popup. Refusing
                // the re-point would route the device prompt to a surface the
                // user cannot see.
                for (const id of msg.signerIds) {
                    if (typeof id !== 'string' || id.length === 0) continue;
                    signerBridge.setTransport(id, transport);
                    ownedIds.add(id);
                }
            } else if (msg.kind === 'unregister' && Array.isArray(msg.signerIds)) {
                for (const id of msg.signerIds) {
                    if (!ownedIds.has(id)) continue;
                    clearIfStillHeld(id);
                    ownedIds.delete(id);
                }
            }
        };

        // Clear an id only while the registry still points it at THIS port
        // (a newer page may have taken it over, and its transport must survive).
        const clearIfStillHeld = (id) => {
            if (signerBridge.getTransport(id) === transport) signerBridge.clearTransport(id);
        };

        const onDisconnect = () => {
            for (const id of ownedIds) clearIfStillHeld(id);
            ownedIds.clear();
        };

        port.onMessage?.addListener(onMessage);
        port.onDisconnect?.addListener(onDisconnect);
    };

    runtime.onConnect.addListener(listener);
    return () => runtime.onConnect.removeListener(listener);
}
