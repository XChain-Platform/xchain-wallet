// Extension-side SDKFactory resolver — mirrors packages/web/src/sdkFactory.js.
//
// Dynamic import so the service worker can boot even when xchain-sdk
// isn't installed (node smokes / CI jobs without workspace install).
// When the real SDK loads, `adaptXChainSDK` produces the production
// factory; otherwise we fall back to a dev-mock that lets onboarding
// persist but throws loudly on signing + broadcast.

import { sdk as sdkLib } from '@xchain-wallet/core';

let warned = false;

/**
 * @param {{ devMockFactory: () => any }} opts
 * @returns {Promise<{ factory: () => any, source: 'real' | 'dev-mock' }>}
 */
export async function resolveSdkFactory({ devMockFactory }) {
    if (typeof devMockFactory !== 'function') {
        throw new Error('resolveSdkFactory: devMockFactory is required');
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
            // eslint-disable-next-line no-console
            console.warn(
                '[xchain-wallet/extension] xchain-sdk unavailable — falling back to dev-mock SDK. '
                    + 'Signing + broadcast will fail. Reason: '
                    + (err?.message || err),
            );
        }
        return { factory: devMockFactory, source: 'dev-mock' };
    }
}

/** Dev SDK stub — matches the web shell's fallback. */
export function createDevMockSdk(constructorOpts) {
    const chainId = constructorOpts?.network || 'bitcoin-mainnet';
    return {
        wallet: {
            deriveAddress(publicKeyHex, opts) {
                return sdkLib.mockDeriveAddress(chainId, opts?.type ?? 'p2wpkh', publicKeyHex);
            },
            signPsbt() { throw new Error('Dev SDK stub: signing requires the real xchain-sdk'); },
            validateAddress(addr) {
                return {
                    valid: typeof addr === 'string' && addr.length > 0,
                    type: null,
                    network: null,
                    error: null,
                };
            },
            broadcastTx() {
                return Promise.reject(new Error('Dev SDK stub: broadcast requires the real xchain-sdk'));
            },
            importWIF() { throw new Error('Dev SDK stub: WIF import requires the real xchain-sdk'); },
        },
        auth: {
            signMessage() { throw new Error('Dev SDK stub: message signing requires the real xchain-sdk'); },
            verifyMessage() { return false; },
            generateChallenge() { return ''; },
        },
    };
}
