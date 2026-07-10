// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Trezor Connect factory (web-app target).
//
// LICENSE NOTE (T-RSL): `@trezor/connect-web` (and its `@trezor/*`
// dependency tree) ships under the Trezor Reference Source License,
// which grants read-only "reference use" and forbids redistribution
// outside your company. Bundling that npm package into a distributed
// SPA is therefore both a T-RSL violation and incompatible with the
// wallet's own AGPL. So we do NOT depend on the npm package. Instead
// we load Trezor Connect at runtime from Trezor's hosted global build
// (`https://connect.trezor.io/9/trezor-connect.js`), which exposes
// `window.TrezorConnect`. The distributed bundle contains zero
// `@trezor/*` code; the browser fetches it from Trezor at pair time,
// i.e. a remote service call, not redistribution. (Requires the web
// CSP to allow-list connect.trezor.io in script-src + frame-src; see
// packages/web/src/csp.js.)
//
// This diverges from the extension shell (which cannot load remote
// scripts at all under MV3 and therefore drops Trezor) and from the
// old design where this file re-exported the extension factory; it is
// now standalone (the two transports have diverged, as anticipated).
// The pair sequence itself still lives in core's `makeTrezorFactory`;
// this file only owns the web-specific hosted-script loader + init.

// Cross-package relative path to core. Matches the convention in
// hostBridge.js so Node smoke scripts resolve the module without the
// pnpm workspace symlink, while Vite still bundles it cleanly.
import { makeTrezorFactory } from '../../../core/src/signerFactories/index.js';

/**
 * Hosted Trezor Connect global build. Pinned to the 9.x line to match
 * the API surface `TrezorSigner` expects (init/getFeatures/getAddress/
 * getPublicKey/signTransaction/signMessage/dispose).
 */
const TREZOR_CONNECT_SCRIPT_SRC = 'https://connect.trezor.io/9/trezor-connect.js';

/**
 * Manifest handed to Trezor Connect at init. Required: Trezor gates
 * the popup on a recognized manifest. Both fields must be accurate;
 * Trezor Connect may block unknown-origin manifests.
 */
const MANIFEST = {
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
};

/** @type {Promise<{ default: any }> | null} */
let scriptLoadPromise = null;
/** @type {Promise<import('@xchain-wallet/core/signers/TrezorSigner.js').TrezorConnect> | null} */
let connectPromise = null;

/**
 * Inject the hosted Trezor Connect script and resolve once
 * `window.TrezorConnect` is available. Cached: the script loads once
 * per page. Shaped as `{ default }` so the existing `mod?.default`
 * unwrap in `getTrezorConnect` keeps working, matching the old npm
 * dynamic-import return.
 *
 * @returns {Promise<{ default: any }>}
 */
function loadHostedTrezorConnect() {
    if (typeof window !== 'undefined' && window.TrezorConnect) {
        return Promise.resolve({ default: window.TrezorConnect });
    }
    if (typeof document === 'undefined') {
        return Promise.reject(
            new Error('trezorFactory: no DOM available to load Trezor Connect (browser-only)'),
        );
    }
    if (!scriptLoadPromise) {
        scriptLoadPromise = new Promise((resolve, reject) => {
            const existing = /** @type {HTMLScriptElement | null} */ (
                document.querySelector(`script[src="${TREZOR_CONNECT_SCRIPT_SRC}"]`)
            );
            const el = existing ?? document.createElement('script');
            el.addEventListener('load', () => {
                if (window.TrezorConnect) {
                    resolve({ default: window.TrezorConnect });
                } else {
                    reject(new Error(
                        'trezorFactory: Trezor Connect script loaded but window.TrezorConnect is undefined',
                    ));
                }
            }, { once: true });
            el.addEventListener('error', () => {
                // Let a later attempt retry the load rather than caching the failure.
                scriptLoadPromise = null;
                reject(new Error(`trezorFactory: failed to load Trezor Connect from ${TREZOR_CONNECT_SCRIPT_SRC}`));
            }, { once: true });
            if (!existing) {
                el.src = TREZOR_CONNECT_SCRIPT_SRC;
                el.async = true;
                document.head.appendChild(el);
            }
        });
    }
    return scriptLoadPromise;
}

/**
 * Lazy-init Trezor Connect. Subsequent calls return the same instance.
 * The `loader` parameter exists for tests. In production it defaults to
 * the hosted-script loader (no bundled `@trezor/*` code).
 *
 * @param {() => Promise<any>} [loader]
 * @returns {Promise<import('@xchain-wallet/core/signers/TrezorSigner.js').TrezorConnect>}
 */
export async function getTrezorConnect(loader = loadHostedTrezorConnect) {
    if (!connectPromise) {
        connectPromise = (async () => {
            const mod = await loader();
            const TrezorConnect = mod?.default ?? mod;
            if (!TrezorConnect || typeof TrezorConnect.init !== 'function') {
                throw new Error('trezorFactory: loaded module does not look like Trezor Connect');
            }
            await TrezorConnect.init({
                manifest: MANIFEST,
                lazyLoad: true,
            });
            return TrezorConnect;
        })();
    }
    return connectPromise;
}

/**
 * Pair a Trezor device. The pair sequence (getFeatures → derive device
 * identifier → construct TrezorSigner → return pairingInfo) lives in
 * core's `makeTrezorFactory`; this export is just the web-side binding.
 *
 * The caller is responsible for calling `flows.registerSigner` with
 * the returned `pairingInfo` to persist the SignerRecord.
 *
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.loader]  for tests
 * @returns {ReturnType<ReturnType<typeof makeTrezorFactory>>}
 */
export async function pairTrezorSigner({ loader } = {}) {
    const factory = makeTrezorFactory({
        getConnect: () => getTrezorConnect(loader),
    });
    return factory();
}

/**
 * Reset the cached Connect instance (not the loaded script). Primarily
 * for tests and "log out of this context" flows.
 */
export function resetTrezorConnect() {
    connectPromise = null;
}
