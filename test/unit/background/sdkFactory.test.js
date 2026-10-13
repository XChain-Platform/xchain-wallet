// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createDevMockSdk,
    resolveSdkFactory,
} from '../../../packages/extension/src/background/sdkFactory.js';

class FakeXChainSDK {}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('extension SDK factory', () => {
    it('adapts a statically injected SDK class', async () => {
        const devMockFactory = vi.fn();

        const result = await resolveSdkFactory({
            devMockFactory,
            XChainSDK: FakeXChainSDK,
        });

        expect(result.source).toBe('real');
        expect(result.factory).toEqual(expect.any(Function));
        expect(result.factory).not.toBe(devMockFactory);
    });

    it('falls back to the dev mock when the injected export is invalid', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const devMockFactory = vi.fn();

        const result = await resolveSdkFactory({ devMockFactory, XChainSDK: undefined });

        expect(result).toEqual({ factory: devMockFactory, source: 'dev-mock' });
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('xchain-sdk did not expose an `XChainSDK` class'),
        );
    });

    it('requires a dev mock factory in non-production builds', async () => {
        await expect(resolveSdkFactory({ XChainSDK: FakeXChainSDK }))
            .rejects.toThrow(/devMockFactory is required/);
    });

    it('provides explicit failures for unsupported dev-mock wallet operations', async () => {
        const sdk = createDevMockSdk({ network: 'bitcoin-mainnet' });

        expect(sdk.wallet.validateAddress('address')).toMatchObject({ valid: true });
        expect(sdk.wallet.validateAddress('')).toMatchObject({ valid: false });
        expect(() => sdk.wallet.signPsbt()).toThrow(/signing requires the real xchain-sdk/);
        expect(() => sdk.wallet.importWIF()).toThrow(/WIF import requires the real xchain-sdk/);
        await expect(sdk.wallet.broadcastTx()).rejects.toThrow(/broadcast requires the real xchain-sdk/);
        expect(() => sdk.auth.signMessage()).toThrow(/message signing requires the real xchain-sdk/);
        expect(sdk.auth.verifyMessage()).toBe(false);
        await expect(sdk.connectWs()).resolves.toBeUndefined();
        expect(sdk.onAddress()).toEqual(expect.any(Function));
    });
});
