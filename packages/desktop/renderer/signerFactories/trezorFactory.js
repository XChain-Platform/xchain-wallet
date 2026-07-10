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
// own AGPL. So we do NOT depend on the npm package; the renderer loads
// Trezor Connect at runtime from Trezor's hosted global build
// (`https://connect.trezor.io/9/trezor-connect.js`, exposing
// `window.TrezorConnect`). The packaged artifact contains zero
// `@trezor/*` code. This requires the renderer CSP to allow-list
// connect.trezor.io in script-src + frame-src (see renderer/index.html);
// it is a deliberate posture change from the previous iframe-only
// (frame-src) allowance, since the hosted script now runs in the
// renderer's own context.
//
// Same pair-sequence shape as the web shell; the sequence itself lives
// in core's `makeTrezorFactory`, this file only owns the desktop
// hosted-script loader + init.

import { makeTrezorFactory } from '@xchain-wallet/core/signerFactories';

/**
 * Hosted Trezor Connect global build (9.x line, matching the API
 * surface TrezorSigner expects).
 */
const TREZOR_CONNECT_SCRIPT_SRC = 'https://connect.trezor.io/9/trezor-connect.js';

/**
 * Trezor Connect manifest. Must match a domain Trezor whitelists or
 * the popup blocks. Desktop uses the same manifest as extension/web
 * for now; a separate desktop manifest is a Step-19 follow-up.
 */
const MANIFEST = {
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
};

/** @type {Promise<{ default: any }> | null} */
let scriptLoadPromise = null;
/** @type {Promise<any> | null} */
let connectPromise = null;

/**
 * Inject the hosted Trezor Connect script and resolve once
 * `window.TrezorConnect` is available. Cached: loads once per renderer.
 * Shaped as `{ default }` so the `mod?.default` unwrap below matches the
 * previous npm dynamic-import return.
 *
 * @returns {Promise<{ default: any }>}
 */
function loadHostedTrezorConnect() {
    if (typeof window !== 'undefined' && window.TrezorConnect) {
        return Promise.resolve({ default: window.TrezorConnect });
    }
    if (typeof document === 'undefined') {
        return Promise.reject(
            new Error('desktop trezorFactory: no DOM available to load Trezor Connect (renderer-only)'),
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
                        'desktop trezorFactory: Trezor Connect script loaded but window.TrezorConnect is undefined',
                    ));
                }
            }, { once: true });
            el.addEventListener('error', () => {
                scriptLoadPromise = null;
                reject(new Error(`desktop trezorFactory: failed to load Trezor Connect from ${TREZOR_CONNECT_SCRIPT_SRC}`));
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
 * Lazy-init Trezor Connect. `loader` is injectable for tests; in
 * production it defaults to the hosted-script loader (no bundled
 * `@trezor/*` code).
 *
 * @param {() => Promise<any>} [loader]
 */
export async function getTrezorConnect(loader = loadHostedTrezorConnect) {
    if (!connectPromise) {
        connectPromise = (async () => {
            const mod = await loader();
            const TrezorConnect = mod?.default ?? mod;
            if (!TrezorConnect || typeof TrezorConnect.init !== 'function') {
                throw new Error('desktop trezorFactory: loaded module does not look like Trezor Connect');
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
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.loader]
 */
export async function pairTrezorSigner({ loader } = {}) {
    const factory = makeTrezorFactory({
        getConnect: () => getTrezorConnect(loader),
    });
    return factory();
}

export function resetTrezorConnect() {
    connectPromise = null;
}
