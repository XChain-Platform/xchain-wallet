// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    createDevMockSdk,
    resolveSdkFactory,
} from '../../../packages/extension/src/background/sdkFactory.js';

describe('extension SDK factory edge branches', () => {
    it('contains a dynamic SDK load failure and warns only once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const devMockFactory = vi.fn();

        await expect(resolveSdkFactory({ devMockFactory }))
            .resolves.toEqual({ factory: devMockFactory, source: 'dev-mock' });
        await expect(resolveSdkFactory({ devMockFactory, XChainSDK: null }))
            .resolves.toEqual({ factory: devMockFactory, source: 'dev-mock' });
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('validates a null options object', async () => {
        await expect(resolveSdkFactory(null)).rejects.toThrow('devMockFactory is required');
    });

    it('covers default mock options and every no-op event surface', async () => {
        const sdk = createDevMockSdk();

        expect(sdk.wallet.deriveAddress('public-key')).toEqual(expect.any(String));
        expect(sdk.wallet.validateAddress(null)).toMatchObject({ valid: false });
        expect(sdk.auth.generateChallenge()).toBe('');
        expect(sdk.disconnectWs()).toBeUndefined();
        expect(sdk.onAddress()()).toBeUndefined();
        expect(sdk.onOrderMatch()()).toBeUndefined();
        expect(sdk.onDispenser()()).toBeUndefined();
        expect(sdk.onCoinpayRequired()()).toBeUndefined();
    });
});
