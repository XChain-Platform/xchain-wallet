// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit tests for the native-coin fee pre-flight guardrail.

import { describe, it, expect } from 'vitest';
import {
    applyNativeFeePreflight,
    NativeFeeForfeitError,
    NATIVE_FEE_WARNING,
} from '../../../packages/core/src/sdk/nativeFeePreflight.js';

// Minimal SDK stub whose quoteNativeFee returns a canned quote and records its args.
function makeSdk(quote) {
    return {
        seen: null,
        async quoteNativeFee(actionData, opts) {
            this.seen = { actionData, opts };
            return Object.assign(
                { supported: true, valid: true, requiredFeeSats: 2000, feeDestination: 'feeDest' },
                quote || {},
            );
        },
    };
}

const ACTION = { action: 'ISSUE', params: { tick: 'NEWTICK' } };

describe('applyNativeFeePreflight', () => {
    it('is a no-op when payFeeInNativeCoin is not set', async () => {
        const sdk = makeSdk();
        const encoderOpts = { pubkey: 'pk', customOutputs: [{ address: 'x', value: 1 }] };
        const out = await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts });
        expect(out.quote).toBe(null);
        expect(out.encoderOpts).toBe(encoderOpts); // same reference, untouched
        expect(sdk.seen).toBe(null); // no quote fetched
    });

    it('sizes the FEE_DESTINATION output to requiredFeeSats and strips the flag', async () => {
        const sdk = makeSdk();
        const out = await applyNativeFeePreflight({
            sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true, pubkey: 'pk' }, source: 'src1',
        });
        expect(out.quote.requiredFeeSats).toBe(2000);
        expect(out.encoderOpts.customOutputs).toEqual([{ address: 'feeDest', value: 2000 }]);
        expect(out.encoderOpts.payFeeInNativeCoin).toBeUndefined();
        expect(out.encoderOpts.pubkey).toBe('pk');
        expect(sdk.seen.opts.source).toBe('src1');
    });

    it('merges the native output with caller-supplied customOutputs', async () => {
        const sdk = makeSdk();
        const out = await applyNativeFeePreflight({
            sdk, actionData: ACTION,
            encoderOpts: { payFeeInNativeCoin: true, customOutputs: [{ address: 'extra', value: 5 }] },
        });
        expect(out.encoderOpts.customOutputs).toHaveLength(2);
        expect(out.encoderOpts.customOutputs.map(o => o.address)).toContain('extra');
        expect(out.encoderOpts.customOutputs.map(o => o.address)).toContain('feeDest');
    });

    it('does not mutate the caller-supplied customOutputs array', async () => {
        const sdk = makeSdk();
        const original = [{ address: 'extra', value: 5 }];
        await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true, customOutputs: original } });
        expect(original).toHaveLength(1);
    });

    it('refuses (throws NativeFeeForfeitError) when the quote is unsupported', async () => {
        const sdk = makeSdk({ supported: false, valid: false, error: 'not supported' });
        await expect(
            applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } }),
        ).rejects.toMatchObject({ name: 'NativeFeeForfeitError', reason: 'unsupported' });
    });

    it('refuses when the oracle price is stale/invalid', async () => {
        const sdk = makeSdk({ supported: true, valid: false, error: 'missing or stale beyond 1800s' });
        let err;
        try {
            await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(NativeFeeForfeitError);
        expect(err.reason).toBe('invalid');
        expect(err.quote.error).toMatch(/stale/);
    });

    it('adds no output when the required native fee is zero', async () => {
        const sdk = makeSdk({ requiredFeeSats: 0 });
        const out = await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } });
        expect(out.encoderOpts.customOutputs).toEqual([]);
        expect(out.quote.requiredFeeSats).toBe(0);
    });

    it('exposes a non-empty forfeiture warning string', () => {
        expect(NATIVE_FEE_WARNING).toMatch(/forfeit/i);
    });
});
