// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ledger transport factory for the Electron desktop renderer.
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

import { makeLedgerFactory, walletOnlyRegistry } from '@xchain-wallet/core/signerFactories';
// +: import the wallet MODULE, not the package index.
//
// The signer needs only WalletUtils (decomposePsbt + txidOf, both pure). Going
// through 'xchain-sdk' pulls the package INDEX into the popup graph, which
// makes it shared between the popup and the service-worker entries - and a
// shared index means the bundler emits sdkFactory's fallback `import()` as a
// real dynamic chunk in the worker build, which ServiceWorkerGlobalScope
// cannot execute. That is exactly how a later change shipped, and the sdk-wiring
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
/** @type {(() => void) | null} */
let sharedDisconnectHandler = null;

/**
 * Cache a transport until it reports disconnect. An unplugged Ledger closes its
 * WebHID device for good, so a kept transport would fail every pairing after
 * the device is plugged back in until the app restarts. @ledgerhq's Transport
 * offers on and off but no once, so the listener removes itself.
 */
function cacheTransport(transport) {
    sharedTransport = transport;
    if (typeof transport?.on !== 'function') return;
    const onDisconnect = () => {
        const remove = transport.off ?? transport.removeListener;
        if (typeof remove === 'function') remove.call(transport, 'disconnect', onDisconnect);
        if (sharedTransport !== transport) return;
        sharedTransport = null;
        sharedDisconnectHandler = null;
    };
    sharedDisconnectHandler = onDisconnect;
    transport.on('disconnect', onDisconnect);
}

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
    const transport = await TransportWebHID.create();
    cacheTransport(transport);
    return transport;
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
        // See the extension binding. signPsbt needs decomposePsbt +
        // txidOf and nothing else, both pure, so the renderer builds a registry
        // that can answer those and nothing more.
        sdkRegistry: walletOnlyRegistry(WalletUtils),
    });
    return factory();
}

export function resetLedgerTransport() {
    const transport = sharedTransport;
    const handler = sharedDisconnectHandler;
    sharedTransport = null;
    sharedDisconnectHandler = null;
    if (transport && handler) {
        const remove = transport.off ?? transport.removeListener;
        if (typeof remove === 'function') remove.call(transport, 'disconnect', handler);
    }
    // Close the device as the extension and web shells do, so a lock or wallet
    // switch ends the session rather than leaving the device open behind it.
    if (typeof transport?.close === 'function') {
        Promise.resolve().then(() => transport.close()).catch(() => {});
    }
}
