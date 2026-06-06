// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// signerBridge — background-side registry of live transport functions
// keyed by signerId. Populated by the renderer (popup / full-screen /
// web) when it opens a long-lived `chrome.runtime.connect({ name:
// 'signer-bridge' })` port and posts a `signer.register` message
// naming its live signer id.
//
// The physical port wiring is not wired up yet — see
// `renderer/signer-bridge.js` (stub) + `background/signerBridge.js`
// port listener (stub) TODO. Until then, the registry stays empty
// and `action.send.hw` rejects with "signer bridge not connected".
// Tests inject their own transport via `signerBridge.setTransport`.
//
// Design:
//
//   renderer (popup/web/desktop)           background (service worker)
//   ─────────────────────────────          ─────────────────────────────
//   at pair-time:
//     TrezorSigner.connect('sig-abc')  →   port.onMessage
//                                             'signer.register' { id }
//                                          signerBridge.setTransport(
//                                             'sig-abc', portTransport)
//
//   at sign-time:
//                                          action.send.hw
//                                          → resolveSigner(address)
//                                          → buildRemoteSigner(desc,
//                                               signerBridge.get(id))
//                                          → sendToken({ signer })
//
//                                             RemoteSigner.signPsbt
//                                          → transport({ op, payload })
//   port.onMessage                       ←    port.postMessage
//     'signer.sign.request'
//   renderer dispatches to its local
//     TrezorSigner.signPsbt + returns
//   port.postMessage                     →  transport resolves
//     'signer.sign.response'
//
// When a port disconnects (tab closed, wallet locked), the registry
// drops all transports that were registered by that port — any
// in-flight sign request rejects with "signer bridge disconnected".

/** @type {Map<string, import('@xchain-wallet/core/signers/RemoteSigner.js').RemoteSignerTransport>} */
const transports = new Map();

/**
 * Register a transport function for a signerId. Called by the port
 * listener when the renderer posts `signer.register`.
 *
 * @param {string} signerId
 * @param {import('@xchain-wallet/core/signers/RemoteSigner.js').RemoteSignerTransport} transport
 */
export function setTransport(signerId, transport) {
    if (!signerId || typeof signerId !== 'string') {
        throw new Error('signerBridge.setTransport: signerId is required');
    }
    if (typeof transport !== 'function') {
        throw new Error('signerBridge.setTransport: transport must be a function');
    }
    transports.set(signerId, transport);
}

/**
 * Look up a registered transport. Returns null when the renderer
 * hasn't registered this signer yet (e.g. the wallet is locked, or
 * the user hasn't opened the popup since pairing).
 *
 * @param {string} signerId
 * @returns {import('@xchain-wallet/core/signers/RemoteSigner.js').RemoteSignerTransport | null}
 */
export function getTransport(signerId) {
    return transports.get(signerId) ?? null;
}

/**
 * Remove a transport registration (e.g. on port disconnect). No-op
 * when the signerId wasn't registered.
 *
 * @param {string} signerId
 */
export function clearTransport(signerId) {
    transports.delete(signerId);
}

/** Drop all transports. Used on lock + tests. */
export function clearAll() {
    transports.clear();
}

/** Diagnostic — registered signer ids. */
export function registeredIds() {
    return Array.from(transports.keys());
}
