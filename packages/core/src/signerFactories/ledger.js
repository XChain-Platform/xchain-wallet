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
// is identical across shells: read the open app off the transport, derive a
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
    readLedgerAppInfo,
} from '../signers/index.js';

const LEDGER_IDENTITY_PATH = "m/44'/0'/0'";

/**
 * @typedef {Object} LedgerFactoryDeps
 * @property {() => Promise<any>} getTransport   resolves to a live Ledger transport
 * @property {() => Promise<any>} getAppClass    resolves to the `@ledgerhq/hw-app-btc` default export (the `Btc` class)
 * @property {import('../sdk/index.js').SDKRegistry} [sdkRegistry]   REQUIRED for signPsbt; see the note below
 */

// `sdkRegistry` used to be UNWIRED, and without it the signer this factory
// builds could not sign a PSBT at all: every hardware attempt failed with
// "requires an sdkRegistry" (reproduced against a real device).
//
// It looked like an architecture call - the web shell's registry lives in
// hostBridge.js, while the extension keeps its registry in the background
// service worker and the live signer in the popup, so the popup would need an
// instance of its own - but the question dissolves once you look at what the
// signer actually ASKS the registry for. `signPsbt` calls exactly two things:
// `wallet.decomposePsbt` and `wallet.txidOf`. Both are pure PSBT/transaction
// parsing with no endpoint, no credentials and no network, so there is nothing
// shell-specific about them and nothing to reach across contexts for.
//
// So each shell hands over a decompose-only registry built by
// `walletOnlyRegistry()` below, from the SDK's own WalletUtils. Core does not
// import xchain-sdk (it takes the SDK by injection everywhere, and the shells
// own that import - the extension's is the MV3 static one ), so the
// builder takes the class rather than reaching for it. Nothing it returns can
// touch the network, which is what makes it safe to construct in the popup:
// the context slice 1 established has no SDK of its own.

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
export function makeLedgerFactory({ getTransport, getAppClass, sdkRegistry }) {
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

        // Read through the transport, not the app client: hw-app-btc's `Btc`
        // class has no `getAppAndVersion` method.
        let appInfo;
        try {
            appInfo = await readLedgerAppInfo(transport);
        } catch (err) {
            throw new Error(`pairLedgerSigner: failed to read app info: ${err?.message || err}`);
        }
        if (!appInfo || !appInfo.name) {
            throw new Error('pairLedgerSigner: device did not report an app name');
        }

        // The identity path is coin-type 0', and the Bitcoin Test app serves
        // ONLY coin-type 1' (verified on Speculos: 44'/0'/0' answers 0x6a82
        // there, 44'/1'/0' answers 0x6a82 on the mainnet app). Pairing with the
        // Test app open therefore always fails, and the device's raw
        // "UNKNOWN_ERROR (0x6a82)" tells the user nothing. Name the cause
        // instead. The wallet does not support Ledger on testnet at all
        // (LedgerSigner's unsupportedBitcoinNetworkError), so this is a
        // wrong-app prompt rather than a missing feature.
        //
        // Worded as end-user copy on purpose: PairSignerForm renders it in the
        // pairing dialog, so it carries no `pairLedgerSigner:` prefix (that
        // prefix is what userFacingMessage strips, and stripping this one
        // would cost the reader the only actionable sentence) and no
        // coin-type / derivation wording (the reason lives in the comment
        // above, where the person who needs it is reading).
        if (appInfo.name !== 'Bitcoin' && /test/i.test(appInfo.name)) {
            throw new Error(
                `The "${appInfo.name}" app is open on this device. `
                + 'Open the Bitcoin app to pair. A hardware signer can only be paired '
                + 'for the main Bitcoin network, not a test one.',
            );
        }

        // Identity xpub at the BTC account-0 path → device identifier.
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
            transport,
            sdkRegistry,
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

/**
 * A minimal SDKRegistry that can answer ONLY the pure wallet-utility calls a
 * hardware signer makes (`decomposePsbt`, `txidOf`). Constructed lazily per
 * chainId and cached, because WalletUtils resolves a network descriptor on
 * construction and a signer signs for one chain many times.
 *
 * It deliberately exposes nothing but `wallet`: if a signer path ever starts
 * needing an explorer or an encoder, it should fail loudly here rather than
 * quietly acquire network access in a context that is not supposed to have any.
 *
 * Takes the class instead of importing it, because core reaches the SDK only
 * through injection and the shells own that import.
 *
 * @param {any} WalletUtils   the SDK's WalletUtils class
 * @returns {{ get: (chainId: string) => { wallet: any } }}
 */
export function walletOnlyRegistry(WalletUtils) {
    const cache = new Map();
    return {
        get(chainId) {
            if (!cache.has(chainId)) {
                cache.set(chainId, { wallet: new WalletUtils(chainId) });
            }
            return cache.get(chainId);
        },
    };
}
