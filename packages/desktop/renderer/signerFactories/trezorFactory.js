// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Trezor Connect factory: Electron desktop renderer.
//
// LICENSE NOTE (T-RSL): `@trezor/connect-web` and its `@trezor/*`
// dependency tree ship under the Trezor Reference Source License,
// which forbids redistribution outside your company. Bundling it into
// the packaged desktop app would violate that license and the wallet's
// own AGPL. So the desktop shell does NOT depend on the npm package; the
// hosted Trezor Connect global build
// (`https://connect.trezor.io/9/trezor-connect.js`, exposing
// `window.TrezorConnect`) is loaded at runtime by the bridge document,
// main/trezorBridge/connect.html. The packaged artifact contains zero
// `@trezor/*` code.
//
// TRUST BOUNDARY (§40.12). The hosted script never runs in this renderer:
// this document holds the preload bridges and shares the session that
// main grants `hid` for a paired Ledger. It runs in a bridge window the
// main process builds on its own isolated session, wired to
// permissions.js#attachHidDenial (see main/trezorBridgeWindow.js). This
// module reaches it only through `window.xchainWalletTrezorBridge`, the
// app preload's narrow relay: `call(method, args)` for the Connect methods
// the signer uses, answered with an `{ ok, result }` or `{ ok: false,
// error }` envelope, and `close()`. Main opens and initializes the window
// on the first call, and a window the person closes settles every waiting
// call with a retryable "Nothing was broadcast" disconnect.
//
// Same pair-sequence shape as the web shell; the sequence itself lives
// in core's `makeTrezorFactory`, this file only binds the desktop relay.

import { makeTrezorFactory, walletOnlyRegistry } from '@xchain-wallet/core/signerFactories';

/**
 * Trezor Connect manifest for the injected-loader path. The bridge window's
 * own init uses main's copy (main/trezorBridgeWindow.js
 * TREZOR_CONNECT_MANIFEST), pinned equal by the bridge tests.
 */
const MANIFEST = {
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
};

/** The app preload's relay world, or a refusal when this window has none. */
function relay() {
    const world = typeof window === 'undefined' ? undefined : window.xchainWalletTrezorBridge;
    if (!world || typeof world.call !== 'function') {
        throw new Error('desktop trezorFactory: the Trezor Connect bridge is not available in this window');
    }
    return world;
}

/**
 * Run one Connect method in main's bridge window and unwrap its envelope.
 *
 * @param {string} method
 * @param {any} [args]
 * @returns {Promise<any>}
 */
async function bridgeCall(method, args) {
    const reply = await relay().call(method, args);
    if (reply && reply.ok === true) return reply.result;
    const message = reply && typeof reply.error === 'string' && reply.error ? reply.error : '';
    throw new Error(message || 'desktop trezorFactory: bridge call failed');
}

/**
 * The object handed back to core's `makeTrezorFactory` / `TrezorSigner`:
 * exactly the method surface they call, each one relayed to the bridge.
 */
function makeConnectProxy() {
    return {
        getFeatures: (args) => bridgeCall('getFeatures', args),
        getAddress: (args) => bridgeCall('getAddress', args),
        getPublicKey: (args) => bridgeCall('getPublicKey', args),
        signTransaction: (args) => bridgeCall('signTransaction', args),
        signMessage: (args) => bridgeCall('signMessage', args),
    };
}

/**
 * Production path: check the relay exists and hand back the proxy. Main
 * opens and initializes the bridge window on the first call.
 *
 * @returns {Promise<any>}
 */
async function connectOverBridge() {
    relay();
    return makeConnectProxy();
}

/** @type {Promise<any> | null} */
let connectPromise = null;

/**
 * Lazy-init Trezor Connect. `loader` is injectable for tests: when given,
 * it bypasses the bridge entirely and must resolve to a usable
 * TrezorConnect-shaped object (or `{ default: <that> }`), the npm
 * dynamic-import return shape. In production (no loader) Trezor Connect
 * runs in main's isolated bridge window. A failed connect is not kept, so
 * the next call tries again.
 *
 * @param {() => Promise<any>} [loader]
 */
export async function getTrezorConnect(loader) {
    if (!connectPromise) {
        const pending = loader ? loadViaInjectedLoader(loader) : connectOverBridge();
        const retryable = pending.catch((err) => {
            if (connectPromise === retryable) connectPromise = null;
            throw err;
        });
        connectPromise = retryable;
    }
    return connectPromise;
}

async function loadViaInjectedLoader(loader) {
    const mod = await loader();
    const TrezorConnect = mod?.default ?? mod;
    if (!TrezorConnect || typeof TrezorConnect.init !== 'function') {
        throw new Error('desktop trezorFactory: loaded module does not look like Trezor Connect');
    }
    await TrezorConnect.init({ manifest: MANIFEST, lazyLoad: true });
    return TrezorConnect;
}

/**
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.loader]
 * @param {() => Promise<any>} [opts.walletLoader]
 */
export async function pairTrezorSigner({ loader, walletLoader = defaultWalletLoader } = {}) {
    const factory = makeTrezorFactory({
        getConnect: () => getTrezorConnect(loader),
        getSdkRegistry: async () => {
            const mod = await walletLoader();
            return walletOnlyRegistry(mod?.default ?? mod);
        },
    });
    return factory();
}

function defaultWalletLoader() {
    return import('xchain-sdk/src/wallet.js');
}

/**
 * Forget the cached proxy and close the bridge window, settling any call
 * still waiting on it.
 */
export function resetTrezorConnect() {
    connectPromise = null;
    const world = typeof window === 'undefined' ? undefined : window.xchainWalletTrezorBridge;
    if (world && typeof world.close === 'function') {
        Promise.resolve().then(() => world.close()).catch(() => {});
    }
}
