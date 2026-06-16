// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ledger transport factory — Electron desktop renderer.
//
// Same shape as the extension binding: lazy-import WebHID transport +
// `@ledgerhq/hw-app-btc`, bind core's `makeLedgerFactory`. Electron's
// Chromium exposes WebHID under the same API as a browser, so the
// transport loads identically; the difference is the main-process
// permission handler (see `packages/desktop/main/permissions.js`)
// that grants `hid` access + filters the device-picker dialog to
// Ledger + Trezor vendor IDs. Without those handlers wired in main,
// `navigator.hid.requestDevice()` from the renderer will return empty
// (Electron's default-deny behavior under `contextIsolation: true`).

import { makeLedgerFactory } from '@xchain-wallet/core/signerFactories';

/** @type {any | null} */
let sharedTransport = null;

/**
 * Lazy-create a shared WebHID transport.
 *
 * @param {() => Promise<any>} [loader]
 */
export async function getLedgerTransport(loader = defaultTransportLoader) {
    if (sharedTransport) return sharedTransport;
    const mod = await loader();
    const TransportWebHID = mod?.default ?? mod;
    if (!TransportWebHID || typeof TransportWebHID.create !== 'function') {
        throw new Error('desktop ledgerFactory: loaded module does not look like @ledgerhq/hw-transport-webhid');
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
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.transportLoader]
 * @param {() => Promise<any>} [opts.appLoader]
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

export function resetLedgerTransport() {
    sharedTransport = null;
}
