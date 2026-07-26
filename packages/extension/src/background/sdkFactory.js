// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Extension-side SDKFactory resolver: mirrors packages/web/src/sdkFactory.js.
//
// The SDK class is INJECTED by the caller (background.js passes the one from
// ./sdkStatic.js). : this resolver used to `await import('xchain-sdk')`
// itself, which can never succeed in a service worker - see sdkStatic.js for
// the full account. The dynamic path survives only for callers that supply no
// class, i.e. Node harnesses running this file outside a bundler; the shipped
// worker never takes it.
//
// When the real SDK is available, `adaptXChainSDK` produces the production
// factory; otherwise we fall back to a dev-mock that lets onboarding persist
// but throws loudly on signing + broadcast.

import { sdk as sdkLib } from '@xchain-wallet/core';

let warned = false;

/**
 * @param {{ devMockFactory: () => any, XChainSDK?: any }} opts
 *   `XChainSDK` present (even as undefined) means the caller owns loading the
 *   SDK statically; the dynamic import is then never attempted, so a shape
 *   change reports itself instead of being masked by a service-worker
 *   `import()` rejection.
 * @returns {Promise<{ factory: () => any, source: 'real' | 'dev-mock' }>}
 */
export async function resolveSdkFactory(opts) {
    const { devMockFactory } = opts ?? {};
    // In production builds the dev mock is dead-code-eliminated  and
    // the background passes null; the PROD branch below throws before the
    // fallback would ever be used, so only require it where it can run.
    if (typeof devMockFactory !== 'function' && !import.meta.env?.PROD) {
        throw new Error('resolveSdkFactory: devMockFactory is required');
    }
    const injected = Object.prototype.hasOwnProperty.call(opts ?? {}, 'XChainSDK');
    try {
        let XChainSDK = opts?.XChainSDK;
        if (!injected) {
            const module = await import('xchain-sdk');
            XChainSDK = module?.XChainSDK ?? module?.default?.XChainSDK ?? module?.default;
        }
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
        // work. A user cannot tell the difference by looking. Fail loudly in a
        // production build. See the web shell's sdkFactory for the full rationale;
        // `import.meta.env.PROD` is statically replaced by Vite, so the dev-mock
        // branch (and its warning string) is eliminated from the release artifact,
        // which is what lets check-no-dev-mock.sh actually mean something.
        // `import.meta.env?.PROD` keeps that exact token (DCE preserved, verified by
        // check-no-dev-mock.sh) while the optional chaining makes the fallback path
        // Node-safe (import.meta.env is undefined under raw Node).
        if (import.meta.env?.PROD) {
            throw new Error(
                '[xchain-wallet/extension] xchain-sdk failed to load in a production build; '
                + 'refusing to fall back to the dev-mock SDK (it serves fake data). Reason: '
                + (err?.message || err),
            );
        }
        if (!warned) {
            warned = true;
            // eslint-disable-next-line no-console -- intentional one-time diagnostic in the background service worker when xchain-sdk fails to load
            console.warn(
                '[xchain-wallet/extension] xchain-sdk unavailable, falling back to dev-mock SDK. '
                    + 'Signing + broadcast will fail. Reason: '
                    + (err?.message || err),
            );
        }
        return { factory: devMockFactory, source: 'dev-mock' };
    }
}

/** Dev SDK stub: matches the web shell's fallback. */
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
        // §46: no-op WebSocket surface so the notification watcher can
        // "connect" against the dev mock without the real explorer WS. It
        // never emits, so no notifications fire in dev-mock mode.
        connectWs() { return Promise.resolve(); },
        disconnectWs() {},
        onAddress() { return () => {}; },
        onOrderMatch() { return () => {}; },
        onDispenser() { return () => {}; },
        onCoinpayRequired() { return () => {}; },
    };
}
