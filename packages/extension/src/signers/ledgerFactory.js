// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ledger transport factory for extension (popup + service worker)
// target. Thin binding layer: the pair sequence itself lives in
// `@xchain-wallet/core/signerFactories/ledger.js` (Phase 2 Step 18),
// shared with web + desktop. This file owns the extension-specific
// WebHID transport + `@ledgerhq/hw-app-btc` lazy-import.
//
// WebHID (§18.2) is Chrome/Edge/Brave-only; Firefox + Safari don't
// support it, so the pairing UI surfaces a compatibility notice on
// unsupported browsers (Step 15).
//
// Lazy-imports `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-btc`
// so the SDK chunks only load when the user pairs a Ledger.

// Cross-package relative path to core; Node smoke scripts resolve
// this without the pnpm workspace symlink.
import { makeLedgerFactory, walletOnlyRegistry } from '../../../core/src/signerFactories/index.js';
//  + : import the wallet MODULE, not the package index.
//
// The signer needs only WalletUtils (decomposePsbt + txidOf, both pure). Going
// through 'xchain-sdk' pulls the package INDEX into the popup graph, which
// makes it shared between the popup and the service-worker entries - and a
// shared index means the bundler emits sdkFactory's fallback `import()` as a
// real dynamic chunk in the worker build, which ServiceWorkerGlobalScope
// cannot execute. That is exactly how  shipped, and the sdk-wiring
// smoke's artifact-level assertion caught it here.
//
// The deep path keeps that boundary intact: the worker's dynamic import still
// resolves to the index, which stays background-only and inlined.
// Namespace + interop, because wallet.js is CJS (`module.exports = WalletUtils`)
// and a default import does not survive every shell's bundler.
import * as walletModule from 'xchain-sdk/src/wallet.js';

const WalletUtils = walletModule.default ?? walletModule;

/** @type {any | null} */
let sharedTransport = null;

/**
 * Lazy-create a shared WebHID transport. Subsequent calls reuse the
 * same transport instance for the extension's lifetime. The `loader`
 * parameter exists for tests.
 *
 * @param {() => Promise<any>} [loader]
 * @returns {Promise<any>}
 */
export async function getLedgerTransport(loader = defaultTransportLoader) {
    if (sharedTransport) return sharedTransport;
    const mod = await loader();
    const TransportWebHID = mod?.default ?? mod;
    if (!TransportWebHID || typeof TransportWebHID.create !== 'function') {
        throw new Error('ledgerFactory: loaded module does not look like @ledgerhq/hw-transport-webhid');
    }
    sharedTransport = await TransportWebHID.create();
    return sharedTransport;
}

function defaultTransportLoader() {
    return import('@ledgerhq/hw-transport-webhid');
}

function defaultAppLoader() {
    return import('@ledgerhq/hw-app-btc');
}

/**
 * Pair a Ledger device. Core's `makeLedgerFactory` owns the pair
 * sequence (read the open app → identity xpub → deviceIdentifier →
 * construct LedgerSigner); this export binds the extension-specific
 * transport + app-class loaders.
 *
 * The caller persists `pairingInfo` via `flows.registerSigner`.
 *
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.transportLoader]
 * @param {() => Promise<any>} [opts.appLoader]
 * @returns {ReturnType<ReturnType<typeof makeLedgerFactory>>}
 */
export async function pairLedgerSigner({
    transportLoader,
    appLoader = defaultAppLoader,
} = {}) {
    const factory = makeLedgerFactory({
        getTransport: () => getLedgerTransport(transportLoader),
        getAppClass: async () => {
            const mod = await appLoader();
            return mod?.default ?? mod;
        },
        // : without this the paired signer throws "requires an
        // sdkRegistry" on every PSBT. The popup has no SDK of its own (all SDK
        // work is host-side, slice 1), but it does not need one: signPsbt only
        // ever calls decomposePsbt + txidOf, both pure parsing. A registry that
        // can do nothing else is safe to build right here.
        sdkRegistry: walletOnlyRegistry(WalletUtils),
    });
    return factory();
}

/**
 * Drop the cached transport. Primarily for tests / browser-HID
 * permission resets.
 */
export function resetLedgerTransport() {
    sharedTransport = null;
}
