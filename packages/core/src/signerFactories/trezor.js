// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// makeTrezorFactory — shell-agnostic Trezor pairing logic (§40.12,
// Phase 2 Step 18).
//
// Core owns the "what to do with an initialized TrezorConnect" part;
// each shell (extension / web / desktop) owns the "how to get an
// initialized TrezorConnect" part via DI — the shells differ in
// manifest URL, `connectSrc` (default vs locally-bundled iframe), and
// lazy-import strategy, but the post-init pair sequence is identical.
//
// Keeping the TrezorConnect instance construction in the shell and the
// pair sequence in core preserves the invariant established in Steps
// 13-14: no `@trezor/connect-web` imports anywhere in @xchain-wallet/core.
// The shells continue to own the native HW SDK deps; core stays
// dep-free.
//
// Shape:
//
//     // in a shell:
//     import { makeTrezorFactory } from '@xchain-wallet/core/signerFactories';
//     import TrezorConnectWeb from '@trezor/connect-web';
//
//     let connectPromise = null;
//     async function getConnect() {
//         if (!connectPromise) connectPromise = (async () => {
//             const TC = TrezorConnectWeb?.default ?? TrezorConnectWeb;
//             await TC.init({ manifest, lazyLoad: true, connectSrc });
//             return TC;
//         })();
//         return connectPromise;
//     }
//
//     export const pairTrezorSigner = makeTrezorFactory({ getConnect });
//     export function resetTrezorConnect() { connectPromise = null; }

import {
    TrezorSigner,
    deviceIdentifierFromFeatures,
    modelFromFeatures,
    firmwareVersionFromFeatures,
} from '../signers/index.js';

/**
 * @typedef {Object} TrezorFactoryDeps
 * @property {() => Promise<import('../signers/TrezorSigner.js').TrezorConnect>} getConnect
 */

/**
 * Build a `pairTrezorSigner` function bound to a shell-specific
 * `getConnect` lazy-loader.
 *
 * The returned function takes no arguments in the production path and
 * returns `{ signer, pairingInfo }`. The caller (PairSignerForm →
 * `flows.registerSigner`) persists the SignerRecord from `pairingInfo`.
 *
 * @param {TrezorFactoryDeps} deps
 * @returns {() => Promise<{
 *   signer: TrezorSigner,
 *   pairingInfo: {
 *     vendor: 'trezor',
 *     model: string,
 *     deviceIdentifier: string,
 *     firmwareVersion: string | null,
 *   },
 * }>}
 */
export function makeTrezorFactory({ getConnect }) {
    if (typeof getConnect !== 'function') {
        throw new Error('makeTrezorFactory: getConnect must be a function');
    }
    return async function pairTrezorSigner() {
        const connect = await getConnect();
        if (!connect || typeof connect.getFeatures !== 'function') {
            throw new Error('makeTrezorFactory: getConnect did not return a usable TrezorConnect');
        }
        const res = await connect.getFeatures();
        if (!res?.success) {
            const msg = res?.payload?.error
                ?? res?.error?.error
                ?? 'Trezor pairing was cancelled or failed';
            throw new Error(`pairTrezorSigner: ${msg}`);
        }
        const features = res.payload;
        const deviceIdentifier = deviceIdentifierFromFeatures(features);
        const model = modelFromFeatures(features);
        const firmwareVersion = firmwareVersionFromFeatures(features);
        if (!deviceIdentifier) {
            throw new Error('pairTrezorSigner: device did not report a device_id or fw_fingerprint');
        }
        if (!model) {
            throw new Error('pairTrezorSigner: device did not report a model');
        }
        const label = features.label || 'Trezor';
        const signer = new TrezorSigner({
            id: `trezor-${deviceIdentifier}`,
            displayName: `${label} (${model})`,
            model,
            deviceIdentifier,
            connect,
        });
        return {
            signer,
            pairingInfo: {
                vendor: 'trezor',
                model,
                deviceIdentifier,
                firmwareVersion,
            },
        };
    };
}
