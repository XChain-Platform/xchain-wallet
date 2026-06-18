// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// makeLedgerFactory: shell-agnostic Ledger pairing logic (§18.2,
// Phase 2 Step 18).
//
// Same split as `makeTrezorFactory`: core owns the post-transport pair
// sequence, each shell owns how it obtains the WebHID transport + the
// `@ledgerhq/hw-app-btc` class. The bitcoin-app pair sequence itself
// is identical across shells: read `getAppAndVersion`, derive a
// device identifier from the account-0 xpub (Ledger has no stable
// serial per §18 rationale), construct a `LedgerSigner`, surface
// `pairingInfo` for `flows.registerSigner`.
//
// Core stays free of `@ledgerhq/*` imports. The shell binds them and
// passes loaders through DI.
//
// Shape:
//
//     import { makeLedgerFactory } from '@xchain-wallet/core/signerFactories';
//
//     let sharedTransport = null;
//     async function getTransport() {
//         if (!sharedTransport) {
//             const mod = await import('@ledgerhq/hw-transport-webhid');
//             const TransportWebHID = mod?.default ?? mod;
//             sharedTransport = await TransportWebHID.create();
//         }
//         return sharedTransport;
//     }
//     async function getAppClass() {
//         const mod = await import('@ledgerhq/hw-app-btc');
//         return mod?.default ?? mod;
//     }
//
//     export const pairLedgerSigner = makeLedgerFactory({ getTransport, getAppClass });

import {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} from '../signers/index.js';

const LEDGER_IDENTITY_PATH = "m/44'/0'/0'";

/**
 * @typedef {Object} LedgerFactoryDeps
 * @property {() => Promise<any>} getTransport   resolves to a live Ledger transport
 * @property {() => Promise<any>} getAppClass    resolves to the `@ledgerhq/hw-app-btc` default export (the `Btc` class)
 */

/**
 * Build a `pairLedgerSigner` function bound to shell-specific
 * transport + app-class loaders.
 *
 * The returned function takes no arguments in the production path
 * and returns `{ signer, pairingInfo }`. Caller persists via
 * `flows.registerSigner`.
 *
 * @param {LedgerFactoryDeps} deps
 * @returns {() => Promise<{
 *   signer: LedgerSigner,
 *   pairingInfo: {
 *     vendor: 'ledger',
 *     model: string,
 *     deviceIdentifier: string,
 *     firmwareVersion: string | null,
 *   },
 * }>}
 */
export function makeLedgerFactory({ getTransport, getAppClass }) {
    if (typeof getTransport !== 'function') {
        throw new Error('makeLedgerFactory: getTransport must be a function');
    }
    if (typeof getAppClass !== 'function') {
        throw new Error('makeLedgerFactory: getAppClass must be a function');
    }
    return async function pairLedgerSigner() {
        const transport = await getTransport();
        if (!transport) {
            throw new Error('makeLedgerFactory: getTransport returned null / undefined');
        }
        const Btc = await getAppClass();
        if (typeof Btc !== 'function') {
            throw new Error('makeLedgerFactory: getAppClass did not return a constructable Btc class');
        }
        const app = new Btc({ transport, currency: 'bitcoin' });

        let appInfo;
        try {
            appInfo = await app.getAppAndVersion();
        } catch (err) {
            throw new Error(`pairLedgerSigner: failed to read app info: ${err?.message || err}`);
        }
        if (!appInfo || !appInfo.name) {
            throw new Error('pairLedgerSigner: device did not report an app name');
        }

        // Identity xpub at the BTC account-0 path → device identifier.
        // Requires the Bitcoin app be open on the device; the
        // `getAppAndVersion` call above surfaces a clear error if not.
        let identity;
        try {
            identity = await app.getWalletPublicKey(LEDGER_IDENTITY_PATH, { verify: false });
        } catch (err) {
            throw new Error(`pairLedgerSigner: failed to read identity xpub: ${err?.message || err}`);
        }
        const deviceIdentifier = await deriveLedgerDeviceIdentifier(identity.publicKey);

        const model = modelFromLedgerTransport(transport?.deviceModel);
        const firmwareVersion = typeof appInfo.version === 'string' ? appInfo.version : null;

        const signer = new LedgerSigner({
            id: `ledger-${deviceIdentifier}`,
            displayName: `Ledger (${model})`,
            model,
            deviceIdentifier,
            app,
        });

        return {
            signer,
            pairingInfo: {
                vendor: 'ledger',
                model,
                deviceIdentifier,
                firmwareVersion,
            },
        };
    };
}
