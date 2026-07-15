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
// Fallback: the dev SDK stub (`createDevMockSdk` in hostBridge.js).
// Used when `xchain-sdk` can't be loaded (e.g. Node smoke tests
// without a workspace install, or the RC-build pipeline before the
// real SDK is pinned. Emits a single console.warn so this state is
// visibly cheap to diagnose.
//
// Signing / broadcast ONLY work under the real factory. Onboarding
// works under either.

import { sdk as sdkLib } from '@xchain-wallet/core';

let warned = false;

/**
 * @returns {Promise<{ factory: import('@xchain-wallet/core').sdk.SDKFactory, source: 'real' | 'dev-mock' }>}
 */
export async function resolveSdkFactory({ devMockFactory }) {
    if (typeof devMockFactory !== 'function') {
        throw new Error('resolveSdkFactory: devMockFactory is required as a safety fallback');
    }
    try {
        const module = await import('xchain-sdk');
        const XChainSDK = module?.XChainSDK ?? module?.default?.XChainSDK ?? module?.default;
        if (typeof XChainSDK !== 'function') {
            throw new Error('xchain-sdk did not expose an `XChainSDK` class');
        }
        return {
            factory: sdkLib.adaptXChainSDK(XChainSDK),
            source: 'real',
        };
    } catch (err) {
        // A shipped wallet must NEVER silently fall back to the mock SDK: it
        // serves fabricated addresses and balances, and signing/broadcast do not
        // work. A user cannot tell the difference by looking, which makes the
        // quiet fallback the dangerous option. Fail loudly in a production build.
        //
        // `import.meta.env.PROD` is statically replaced by Vite, so in a release
        // bundle this collapses to `if (true) throw`, and the dev-mock branch
        // below (including its warning string) is dead-code-eliminated out of the
        // artifact entirely. That is what makes tools/build-reproduce's
        // check-no-dev-mock.sh a real gate rather than a string that is compiled
        // into every build and therefore always trips.
        //
        // `import.meta.env?.PROD` keeps the exact token Vite statically replaces
        // (DCE still verified by tools/build-reproduce/check-no-dev-mock.sh), while
        // the optional chaining short-circuits under raw Node - where
        // `import.meta.env` is undefined - so importing this module in a Node test
        // harness (the sdk-wiring smoke) doesn't throw on the fallback path.
        if (import.meta.env?.PROD) {
            throw new Error(
                '[xchain-wallet/web] xchain-sdk failed to load in a production build; '
                + 'refusing to fall back to the dev-mock SDK (it serves fake data). Reason: '
                + (err?.message || err),
            );
        }
        if (!warned) {
            warned = true;
            // eslint-disable-next-line no-console -- intentional one-time diagnostic for dev-mock SDK fallback
            console.warn(
                '[xchain-wallet/web] xchain-sdk unavailable, falling back to dev-mock SDK. '
                    + 'Signing + broadcast will fail. Reason: '
                    + (err?.message || err),
            );
        }
        return { factory: devMockFactory, source: 'dev-mock' };
    }
}
