// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  regression. The native-coin fee used to be a plain opt-in that
// started OFF on every chain, which is only correct on Bitcoin. On LTC/DOGE
// the indexer rejects a fee-bearing action that carries no FEE_DESTINATION
// output (`insufficient fee (native coin output required)`), so the old
// default composed transactions that paid a miner fee and never indexed.
// These tests pin the shape of the fix: forced on where it is the only fee
// lane, still a free choice on Bitcoin, and re-derived when the chain changes.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNativeFee } from '../../../packages/core/src/shared/hooks/useNativeFee.js';
import { applyNativeFeePreflight } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const FEE_DEST = 'mrFeeDestinationRegtest';

/** An indexer that prices the fee, as the real `feequote` does for a quotable action. */
function quotingSdk() {
    return {
        quoteNativeFee: vi.fn(async () => ({
            supported: true, valid: true, requiredFeeSats: 50000, feeDestination: FEE_DEST,
        })),
    };
}

describe('useNativeFee', () => {
    it('is an opt-in that starts off on Bitcoin, which can pay the fee in XCHAIN', () => {
        const { result } = renderHook(() => useNativeFee('bitcoin-regtest'));
        expect(result.current.mandatory).toBe(false);
        expect(result.current.payFeeInNativeCoin).toBe(false);
        expect(result.current.flag).toBe(undefined);

        act(() => result.current.setPayFeeInNativeCoin(true));
        expect(result.current.payFeeInNativeCoin).toBe(true);
        expect(result.current.flag).toBe(true);
    });

    it('is forced on for LTC and DOGE, where a native output is the only fee', () => {
        for (const chain of ['litecoin-regtest', 'dogecoin-mainnet', 'LTC', { coin: 'dogecoin' }]) {
            const { result } = renderHook(() => useNativeFee(chain));
            expect(result.current.mandatory).toBe(true);
            expect(result.current.payFeeInNativeCoin).toBe(true);
            expect(result.current.flag).toBe(true);
            expect(result.current.toggleProps.checked).toBe(true);
            expect(result.current.toggleProps.mandatory).toBe(true);
        }
    });

    it('cannot be switched back off on a chain that has no other fee lane', () => {
        const { result } = renderHook(() => useNativeFee('litecoin-regtest'));
        act(() => result.current.setPayFeeInNativeCoin(false));
        expect(result.current.payFeeInNativeCoin).toBe(true);
        expect(result.current.flag).toBe(true);
    });

    it('re-answers when the chain resolves late or the user switches chains', () => {
        // The chain is null on the first render of most forms: the descriptor
        // only exists once the chain picker settles.
        const { result, rerender } = renderHook(({ chain }) => useNativeFee(chain), {
            initialProps: { chain: null },
        });
        expect(result.current.payFeeInNativeCoin).toBe(false);

        rerender({ chain: 'litecoin-regtest' });
        expect(result.current.mandatory).toBe(true);
        expect(result.current.payFeeInNativeCoin).toBe(true);

        rerender({ chain: 'bitcoin-regtest' });
        expect(result.current.mandatory).toBe(false);
        expect(result.current.payFeeInNativeCoin).toBe(false);
    });

    it('keeps a Bitcoin opt-in when the user switches to LTC and back', () => {
        const { result, rerender } = renderHook(({ chain }) => useNativeFee(chain), {
            initialProps: { chain: 'bitcoin-regtest' },
        });
        act(() => result.current.setPayFeeInNativeCoin(true));
        rerender({ chain: 'litecoin-regtest' });
        expect(result.current.payFeeInNativeCoin).toBe(true);
        rerender({ chain: 'bitcoin-regtest' });
        expect(result.current.payFeeInNativeCoin).toBe(true);
    });
});

describe('default form state through the submit preflight ', () => {
    it('builds the FEE_DESTINATION output on LTC without the user touching anything', async () => {
        const { result } = renderHook(() => useNativeFee('litecoin-regtest'));
        const sdk = quotingSdk();

        const { encoderOpts, quote } = await applyNativeFeePreflight({
            sdk,
            actionData: { action: 'ORDER', params: {} },
            encoderOpts: { payFeeInNativeCoin: result.current.flag },
            source: 'mrSource',
        });

        expect(sdk.quoteNativeFee).toHaveBeenCalledTimes(1);
        expect(quote.requiredFeeSats).toBe(50000);
        expect(encoderOpts.customOutputs).toEqual([{ address: FEE_DEST, value: 50000 }]);
        // The internal flag never reaches the encoder.
        expect(encoderOpts.payFeeInNativeCoin).toBe(undefined);
    });

    it('still composes a Bitcoin action with no fee output, paying the fee in XCHAIN', async () => {
        const { result } = renderHook(() => useNativeFee('bitcoin-regtest'));
        const sdk = quotingSdk();

        const { encoderOpts, quote } = await applyNativeFeePreflight({
            sdk,
            actionData: { action: 'ORDER', params: {} },
            encoderOpts: { payFeeInNativeCoin: result.current.flag },
            source: 'mrSource',
        });

        expect(sdk.quoteNativeFee).not.toHaveBeenCalled();
        expect(quote).toBe(null);
        expect(encoderOpts.customOutputs).toBe(undefined);
    });

    it('adds no output for a zero-fee action, so forcing the flag on is safe', async () => {
        const { result } = renderHook(() => useNativeFee('dogecoin-regtest'));
        // What the indexer answers when the action carries no protocol fee.
        const sdk = {
            quoteNativeFee: vi.fn(async () => ({
                supported: true, valid: true, requiredFeeSats: 0, feeDestination: FEE_DEST,
            })),
        };

        const { encoderOpts } = await applyNativeFeePreflight({
            sdk,
            actionData: { action: 'BROADCAST', params: {} },
            encoderOpts: { payFeeInNativeCoin: result.current.flag },
            source: 'mrSource',
        });

        expect(encoderOpts.customOutputs).toEqual([]);
    });
});
