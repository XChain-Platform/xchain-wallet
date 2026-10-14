// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    applyNativeFeePreflight,
    dustThresholdForCoin,
    NativeFeeForfeitError,
    resolveDustThreshold,
} from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const ACTION = { action: 'DEPLOY', params: {} };

const sdkWithQuote = (quote) => ({
    wallet: { getBitcoinNetwork: () => ({ dustThreshold: 546 }) },
    quoteNativeFee: vi.fn(async () => quote),
});

describe('native fee preflight edge branches', () => {
    it('refuses a missing quote API and an already-aborted request', async () => {
        await expect(applyNativeFeePreflight({
            sdk: {}, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true },
        })).rejects.toThrow(/quoteNativeFee is unavailable/);

        const controller = new AbortController();
        controller.abort();
        const sdk = sdkWithQuote({ supported: true, valid: true, requiredFeeSats: 1 });
        await expect(applyNativeFeePreflight({
            sdk,
            actionData: ACTION,
            encoderOpts: { payFeeInNativeCoin: true },
            signal: controller.signal,
        })).rejects.toThrow('aborted');
        expect(sdk.quoteNativeFee).not.toHaveBeenCalled();
    });

    it('treats a null quote as unsupported', async () => {
        const sdk = sdkWithQuote(null);
        await expect(applyNativeFeePreflight({
            sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true },
        })).rejects.toMatchObject({ name: 'NativeFeeForfeitError', reason: 'unsupported', quote: null });
    });

    it('accepts an unverified null verdict and forwards progress and cancellation state', async () => {
        const quote = {
            supported: true,
            valid: null,
            staticQuote: true,
            requiredFeeSats: '546',
            requiredFeeNative: '0.00000546',
            feeDestination: 'fee-destination',
        };
        const sdk = sdkWithQuote(quote);
        const onProgress = vi.fn();
        const controller = new AbortController();

        const result = await applyNativeFeePreflight({
            sdk,
            actionData: ACTION,
            encoderOpts: { payFeeInNativeCoin: true, customOutputs: null },
            source: 'spender',
            signal: controller.signal,
            onProgress,
        });

        expect(sdk.quoteNativeFee).toHaveBeenCalledWith(ACTION, {
            source: 'spender', signal: controller.signal,
        });
        expect(onProgress.mock.calls.map(([phase]) => phase)).toEqual([
            'quoting_native_fee', 'native_fee_quoted',
        ]);
        expect(result.quote).toBe(quote);
        expect(result.encoderOpts.customOutputs).toEqual([{ address: 'fee-destination', value: 546 }]);
    });

    it('preserves the most useful forfeit detail in each constructor branch', () => {
        expect(new NativeFeeForfeitError({
            reason: 'dust', quote: { requiredFeeNative: '0.00000001', error: 'ignored' },
        }).message).toMatch(/0\.00000001 is below the dust threshold/);
        expect(new NativeFeeForfeitError({
            reason: 'invalid', quote: { error: 'invalid: insufficient funds' },
        }).message).toMatch(/invalid: insufficient funds$/);
        expect(new NativeFeeForfeitError({ reason: 'unsupported', quote: null }).message)
            .toMatch(/unsupported$/);
    });

    it('returns null for unknown, non-positive, or unreadable dust floors', () => {
        expect(dustThresholdForCoin('BITCOIN')).toBe(546);
        expect(dustThresholdForCoin('unknown')).toBeNull();
        expect(resolveDustThreshold({
            wallet: { getBitcoinNetwork: () => ({ dustThreshold: 0 }) },
        })).toBeNull();
        expect(resolveDustThreshold({
            wallet: { getBitcoinNetwork: () => ({ dustThreshold: 'not-a-number' }) },
        })).toBeNull();
    });
});
