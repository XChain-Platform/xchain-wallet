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
// renderer the user most recently interacted with. Disconnect
// tears down only the transports this specific port registered.

import { signers } from '@xchain-wallet/core';
import * as signerBridge from './signerBridge.js';
import { isTrustedExtensionSender } from '../bridge/publicSurface.js';

const { createBackgroundTransport } = signers;

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
                for (const id of msg.signerIds) {
                    if (typeof id !== 'string' || id.length === 0) continue;
                    signerBridge.setTransport(id, transport);
                    ownedIds.add(id);
                }
            } else if (msg.kind === 'unregister' && Array.isArray(msg.signerIds)) {
                for (const id of msg.signerIds) {
                    if (!ownedIds.has(id)) continue;
                    signerBridge.clearTransport(id);
                    ownedIds.delete(id);
                }
            }
        };

        const onDisconnect = () => {
            for (const id of ownedIds) signerBridge.clearTransport(id);
            ownedIds.clear();
        };

        port.onMessage?.addListener(onMessage);
        port.onDisconnect?.addListener(onDisconnect);
    };

    runtime.onConnect.addListener(listener);
    return () => runtime.onConnect.removeListener(listener);
}
