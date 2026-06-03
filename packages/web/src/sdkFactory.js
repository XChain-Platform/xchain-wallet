// Resolve an SDKFactory for the web shell.
//
// Preferred path: wrap the real `xchain-sdk` via `adaptXChainSDK`
// (`@xchain-wallet/core/sdk`). `xchain-sdk` is CJS + loads a handful
// of Node-style deps — Vite can bundle the class entry today (the
// server-side `api.js` / express bits aren't touched by the wallet
// flows, so tree-shaking keeps them out of the web bundle).
//
// Fallback: the dev SDK stub (`createDevMockSdk` in hostBridge.js).
// Used when `xchain-sdk` can't be loaded — e.g. Node smoke tests
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
        if (!warned) {
            warned = true;
            // eslint-disable-next-line no-console -- intentional one-time diagnostic for dev-mock SDK fallback
            console.warn(
                '[xchain-wallet/web] xchain-sdk unavailable — falling back to dev-mock SDK. '
                    + 'Signing + broadcast will fail. Reason: '
                    + (err?.message || err),
            );
        }
        return { factory: devMockFactory, source: 'dev-mock' };
    }
}
