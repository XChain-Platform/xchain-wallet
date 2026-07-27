// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the web shell's SDK venue is CHOSEN, not caught.
//
// The resolver used to decide between the real xchain-sdk and the dev mock by
// trying the import and treating the exception as "use the mock". That made
// the venue a property of the bundler: the day Vite started pre-bundling the
// linked CJS SDK, the dev shell silently switched to the real SDK against
// mainnet explorers no test browser can reach, every compose failed with "the
// network is unreachable", and five dev-server e2e specs went red for a reason
// unrelated to what they test.
//
// These tests pin the policy itself: the environment names the venue, the
// mock venue never imports the SDK, and the real venue never substitutes the
// mock when the load fails.

import { describe, it, expect, vi } from 'vitest';
import {
    REAL_SDK_ENV_FLAG,
    selectSdkVenue,
    resolveSdkFactory,
} from '../../../packages/web/src/sdkFactory.js';

const devMock = () => ({ wallet: {}, auth: {} });
class FakeXChainSDK {}

describe('selectSdkVenue', () => {
    it('names the flag callers set to opt dev into the real SDK', () => {
        expect(REAL_SDK_ENV_FLAG).toBe('VITE_XCHAIN_REAL_SDK');
    });

    it('always runs the real SDK in a production build', () => {
        expect(selectSdkVenue({ PROD: true })).toBe('real');
    });

    it('cannot be talked out of the real SDK in production by the dev flag', () => {
        expect(selectSdkVenue({ PROD: true, [REAL_SDK_ENV_FLAG]: '0' })).toBe('real');
    });

    it('defaults dev and test builds to the dev mock', () => {
        // The default chains point at mainnet explorers; a dev box or a CI
        // browser generally cannot reach them, so the mock is the useful venue.
        expect(selectSdkVenue({ PROD: false })).toBe('dev-mock');
        expect(selectSdkVenue({})).toBe('dev-mock');
        expect(selectSdkVenue(undefined)).toBe('dev-mock');
    });

    it('opts dev into the real SDK when the flag is exactly "1"', () => {
        expect(selectSdkVenue({ PROD: false, [REAL_SDK_ENV_FLAG]: '1' })).toBe('real');
        expect(selectSdkVenue({ PROD: false, [REAL_SDK_ENV_FLAG]: 'true' })).toBe('dev-mock');
        expect(selectSdkVenue({ PROD: false, [REAL_SDK_ENV_FLAG]: '' })).toBe('dev-mock');
    });

    it('reads the ambient env under vitest, which is a dev-mock venue', () => {
        expect(selectSdkVenue()).toBe('dev-mock');
    });
});

describe('resolveSdkFactory', () => {
    it('serves the dev mock without importing xchain-sdk at all', async () => {
        // The point of the fix: no import means no bundler behaviour can flip
        // the venue underneath a test suite.
        const importSdk = vi.fn(async () => ({ XChainSDK: FakeXChainSDK }));
        const result = await resolveSdkFactory({
            devMockFactory: devMock, venue: 'dev-mock', importSdk,
        });
        expect(result.source).toBe('dev-mock');
        expect(result.factory).toBe(devMock);
        expect(importSdk).not.toHaveBeenCalled();
    });

    it('adapts the real SDK when the real venue is selected', async () => {
        const importSdk = vi.fn(async () => ({ XChainSDK: FakeXChainSDK }));
        const result = await resolveSdkFactory({
            devMockFactory: devMock, venue: 'real', importSdk,
        });
        expect(importSdk).toHaveBeenCalledTimes(1);
        expect(result.source).toBe('real');
        expect(result.factory).not.toBe(devMock);
        expect(typeof result.factory).toBe('function');
    });

    it('accepts a default export shaped module', async () => {
        const result = await resolveSdkFactory({
            devMockFactory: devMock,
            venue: 'real',
            importSdk: async () => ({ default: { XChainSDK: FakeXChainSDK } }),
        });
        expect(result.source).toBe('real');
    });

    it('refuses to substitute the mock when the real SDK fails to load', async () => {
        // Silently handing back fabricated balances to a caller who asked for
        // the real SDK is the failure mode this whole item is about.
        await expect(resolveSdkFactory({
            devMockFactory: devMock,
            venue: 'real',
            importSdk: async () => { throw new Error('bundle broke'); },
        })).rejects.toThrow(/refusing to fall back to the dev-mock SDK.*bundle broke/s);
    });

    it('refuses a real venue whose module has no XChainSDK class', async () => {
        await expect(resolveSdkFactory({
            devMockFactory: devMock,
            venue: 'real',
            importSdk: async () => ({ nothing: true }),
        })).rejects.toThrow(/did not expose an `XChainSDK` class/);
    });

    it('treats a missing dev mock as the wiring bug it is', async () => {
        await expect(resolveSdkFactory({ venue: 'dev-mock' }))
            .rejects.toThrow(/devMockFactory is required/);
    });
});
