// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Resolve an SDKFactory for the web shell.
//
// Preferred path: wrap the real `xchain-sdk` via `adaptXChainSDK`
// (`@xchain-wallet/core/sdk`). `xchain-sdk` is CJS + loads a handful
// of Node-style deps. Vite can bundle the class entry today (the
// server-side `api.js` / express bits aren't touched by the wallet
// flows, so tree-shaking keeps them out of the web bundle).
//
// Other path: the dev SDK stub (`createDevMockSdk` in hostBridge.js),
// which serves the fake dataset the dev shell and the dev-server e2e
// suite run against.
//
// Signing / broadcast ONLY work under the real factory. Onboarding
// works under either.
//
// : WHICH of the two runs is a DELIBERATE choice, never a
// side effect of bundling. It used to be decided by `try { import }
// catch`: the dev server could not transform the linked CJS SDK, the
// import threw, and the catch handed back the mock. When Vite started
// pre-bundling `xchain-sdk` into `.vite/deps/` the import began to
// SUCCEED, so the dev shell silently switched to the real SDK pointed
// at MAINNET explorers no test browser can reach, every compose failed
// with "the network is unreachable", and five e2e specs went red for a
// reason that had nothing to do with their subject. A test venue that
// flips whenever a bundler improves is not a venue.
//
// So the venue is now read off the environment before anything is
// imported (`selectSdkVenue`), and a failure on the real path is a hard
// failure in every build: nothing silently degrades to fake data.

import { sdk as sdkLib } from '@xchain-wallet/core';

let warned = false;

// Opt the dev shell into the real SDK. Same flag gates the dev server's
// pre-bundling of `xchain-sdk` in packages/web/vite.config.js, so one
// switch moves the whole venue: `VITE_XCHAIN_REAL_SDK=1 pnpm -C packages/web dev`.
export const REAL_SDK_ENV_FLAG = 'VITE_XCHAIN_REAL_SDK';

/**
 * Which SDK this shell is meant to run on, decided from the build/run
 * environment alone (no imports, no exception handling).
 *
 * - production builds: always `real`. A shipped wallet has no mock (it is
 *   dead-code-eliminated, ) and must never serve fabricated data.
 * - dev/test: `dev-mock` unless `VITE_XCHAIN_REAL_SDK=1` asks for the real
 *   one, because the default dev chains point at mainnet explorers that a
 *   dev box or a CI browser generally cannot reach.
 *
 * @param {Record<string, unknown>} [env]
 * @returns {'real' | 'dev-mock'}
 */
export function selectSdkVenue(env = import.meta.env) {
    if (env?.PROD) return 'real';
    return env?.VITE_XCHAIN_REAL_SDK === '1' ? 'real' : 'dev-mock';
}

/**
 * @param {object} opts
 * @param {import('@xchain-wallet/core').sdk.SDKFactory | null} [opts.devMockFactory]
 * @param {'real' | 'dev-mock'} [opts.venue] override for tests; defaults to `selectSdkVenue()`
 * @param {() => Promise<any>} [opts.importSdk] override for tests; defaults to importing `xchain-sdk`
 * @returns {Promise<{ factory: import('@xchain-wallet/core').sdk.SDKFactory, source: 'real' | 'dev-mock' }>}
 */
export async function resolveSdkFactory({
    devMockFactory,
    venue = selectSdkVenue(),
    importSdk = () => import('xchain-sdk'),
} = {}) {
    // The outer test keeps the literal `import.meta.env?.PROD` token Vite
    // statically replaces, so a release bundle collapses this to `if (false)`
    // and dead-code-eliminates the whole mock branch, warning string included
    // (; tools/build-reproduce/check-no-dev-mock.sh is the gate). It also
    // states the invariant structurally: a production build cannot reach the
    // mock, whatever `venue` says. The optional chaining keeps the module
    // importable under raw Node, where `import.meta.env` is undefined.
    if (!import.meta.env?.PROD && venue !== 'real') {
        // The mock is the chosen venue here, so its absence is a wiring bug,
        // not something to paper over. (In production the venue is always
        // `real` and callers pass null, which is why this is not checked there.)
        if (typeof devMockFactory !== 'function') {
            throw new Error('resolveSdkFactory: devMockFactory is required as a safety fallback');
        }
        if (!warned) {
            warned = true;
            // eslint-disable-next-line no-console -- intentional one-time diagnostic: this shell is on fake data
            console.warn(
                '[xchain-wallet/web] dev-mock SDK selected (no '
                    + REAL_SDK_ENV_FLAG
                    + '=1). Balances and addresses are fabricated; signing + broadcast will fail. '
                    + 'Run with ' + REAL_SDK_ENV_FLAG + '=1 against a reachable explorer for the real SDK.',
            );
        }
        return { factory: devMockFactory, source: 'dev-mock' };
    }
    try {
        const module = await importSdk();
        const XChainSDK = module?.XChainSDK ?? module?.default?.XChainSDK ?? module?.default;
        if (typeof XChainSDK !== 'function') {
            throw new Error('xchain-sdk did not expose an `XChainSDK` class');
        }
        return {
            factory: sdkLib.adaptXChainSDK(XChainSDK),
            source: 'real',
        };
    } catch (err) {
        // The real SDK was ASKED for and could not be loaded. Never fall back
        // to the mock here: it serves fabricated addresses and balances and
        // cannot sign, and a user (or a test) cannot tell the difference by
        // looking, which makes the quiet fallback the dangerous option. That
        // quiet fallback is also what made the dev venue an accident of
        // bundling  and shipped as /557 in production.
        //
        // Whoever wants the mock says so with the env flag; anyone who does not
        // gets an error naming the reason.
        throw new Error(
            '[xchain-wallet/web] xchain-sdk failed to load'
            + (import.meta.env?.PROD ? ' in a production build' : '')
            + '; refusing to fall back to the dev-mock SDK (it serves fake data). Reason: '
            + (err?.message || err),
        );
    }
}
