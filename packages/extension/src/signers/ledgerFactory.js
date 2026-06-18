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
import { makeLedgerFactory } from '../../../core/src/signerFactories/index.js';

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
 * sequence (getAppAndVersion → identity xpub → deviceIdentifier →
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
