// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Web-shell signer bridge. Unlike the extension popup — which opens
// a long-lived chrome.runtime port so the renderer-hosted signer is
// reachable from the service-worker-hosted background — web's
// "background" (the MessageHost returned by `createBackgroundHost`)
// runs in the same JS context as the React tree. No ipc boundary
// means no port: the transport wired into `signerBridge.setTransport`
// can call the live Signer's methods directly.
//
// The extension's `signerBridge` module (in the background package)
// is imported by `createBackgroundHost` and resolves on the first
// `action.*.hw` call. The web hostBridge constructs its host from
// the same `createBackgroundHost`, which means it shares that same
// module-scoped Map. Registering here reaches the handler chain.

import * as bgSignerBridge from '../../extension/src/background/signerBridge.js';

/** @type {Map<string, import('@xchain-wallet/core/signers/Signer.js').Signer>} */
const liveSigners = new Map();

/**
 * Register a live Signer so `action.*.hw` handlers can reach it.
 * Called by `PairSignerForm`'s `onSignerPaired` hook after the
 * SignerRecord is persisted.
 *
 * @param {string} signerId
 * @param {import('@xchain-wallet/core/signers/Signer.js').Signer} signer
 */
export function registerSigner(signerId, signer) {
    if (typeof signerId !== 'string' || signerId.length === 0) {
        throw new Error('signerBridge.registerSigner: signerId is required');
    }
    if (!signer || typeof signer.signPsbt !== 'function') {
        throw new Error('signerBridge.registerSigner: signer must implement Signer');
    }
    liveSigners.set(signerId, signer);
    bgSignerBridge.setTransport(signerId, inProcessTransport);
}

/**
 * Drop a registration (rare — user unpairs the device).
 * @param {string} signerId
 */
export function unregisterSigner(signerId) {
    if (!liveSigners.delete(signerId)) return;
    bgSignerBridge.clearTransport(signerId);
}

/** @returns {string[]} */
export function registeredIds() {
    return Array.from(liveSigners.keys());
}

/**
 * Shared transport — all signerIds route through this single
 * function (it reads signerId off the payload). Saves allocating a
 * closure per signer; the identity also makes the signerBridge
 * registry's Map-ness trivially observable in tests.
 *
 * @type {import('@xchain-wallet/core/signers/RemoteSigner.js').RemoteSignerTransport}
 */
async function inProcessTransport({ op, payload }) {
    const signerId = payload?.signerId;
    const signer = liveSigners.get(signerId);
    if (!signer) {
        const err = new Error(`signerBridge: no web signer registered for id "${signerId}"`);
        err.name = 'SignerNotRegisteredError';
        throw err;
    }
    switch (op) {
        case 'status':
            return signer.getStatus(payload);
        case 'getAddresses':
            return signer.getAddresses(payload);
        case 'getPublicKey':
            return signer.getPublicKey(payload);
        case 'signPsbt':
            return signer.signPsbt(payload);
        case 'signMessage':
            return signer.signMessage(payload);
        default:
            throw new Error(`signerBridge: unknown op "${op}"`);
    }
}
