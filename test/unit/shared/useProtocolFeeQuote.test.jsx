// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProtocolFeeQuote } from '../../../packages/core/src/shared/hooks/useProtocolFeeQuote.js';

const BASE = {
    chainId: 'bitcoin-regtest',
    source: 'bc1qsource',
    actionString: 'SWEEP|1|source',
    enabled: true,
};

let messaging;

function render(overrides = {}) {
    return renderHook(
        (props) => useProtocolFeeQuote({ messaging, ...BASE, ...props }),
        { initialProps: overrides },
    );
}

async function advance(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
    vi.useFakeTimers();
    globalThis.jest = { advanceTimersByTime: (ms) => vi.advanceTimersByTime(ms) };
    messaging = { requoteNativeFee: vi.fn() };
});

afterEach(() => {
    delete globalThis.jest;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useProtocolFeeQuote', () => {
    it('debounces the quote by 400 ms and exposes pending state', async () => {
        messaging.requoteNativeFee.mockResolvedValue({ xchainFee: '0.064', requiredFeeSats: 197 });
        const { result } = render();

        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(399);
        expect(messaging.requoteNativeFee).not.toHaveBeenCalled();
        await advance(1);
        expect(messaging.requoteNativeFee).toHaveBeenCalledWith({
            chainId: BASE.chainId,
            source: BASE.source,
            actionString: BASE.actionString,
        });
        await waitFor(() => expect(result.current).toEqual({
            quote: { xchainFee: '0.064', requiredFeeSats: 197 }, pending: false,
        }));
    });

    it('cancels a stale result when quote inputs change', async () => {
        let resolveFirst;
        messaging.requoteNativeFee
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ xchainFee: '0.2', requiredFeeSats: 400 });
        const { result, rerender } = render();
        await advance(400);
        rerender({ actionString: 'SWEEP|1|next' });
        await act(async () => {
            resolveFirst({ xchainFee: '0.1', requiredFeeSats: 200 });
            await Promise.resolve();
        });
        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(400);
        await waitFor(() => expect(result.current.quote).toEqual({
            xchainFee: '0.2', requiredFeeSats: 400,
        }));
    });

    it('swallows quote errors and clears pending', async () => {
        messaging.requoteNativeFee.mockRejectedValue(new Error('offline'));
        const { result } = render();
        await advance(400);
        await waitFor(() => expect(result.current).toEqual({ quote: null, pending: false }));
    });

    it('does not quote while disabled or incomplete', async () => {
        const { result } = render({ enabled: false });
        expect(result.current).toEqual({ quote: null, pending: false });
        await advance(400);
        expect(messaging.requoteNativeFee).not.toHaveBeenCalled();
    });

    it('stays pending while an enabled quote is incomplete', async () => {
        const { result } = render({ actionString: null });
        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(400);
        expect(messaging.requoteNativeFee).not.toHaveBeenCalled();
    });

    it('quotes by action and params through quoteProtocolFee', async () => {
        messaging.quoteProtocolFee = vi.fn().mockResolvedValue({ xchainFee: '0.5', requiredFeeSats: 900 });
        const actionData = { action: 'SWEEP', params: { VERSION: '0', DESTINATION: 'bc1qdest' } };
        const { result } = render({ actionString: undefined, actionData });

        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(400);
        expect(messaging.quoteProtocolFee).toHaveBeenCalledWith({
            chainId: BASE.chainId,
            source: BASE.source,
            actionData,
        });
        expect(messaging.requoteNativeFee).not.toHaveBeenCalled();
        await waitFor(() => expect(result.current).toEqual({
            quote: { xchainFee: '0.5', requiredFeeSats: 900 }, pending: false,
        }));
    });

    it('does not requote when an equal param map is rebuilt in another key order', async () => {
        messaging.quoteProtocolFee = vi.fn().mockResolvedValue({ xchainFee: '0.5' });
        const { rerender } = render({
            actionString: undefined,
            actionData: { action: 'SWEEP', params: { VERSION: '0', DESTINATION: 'bc1qdest' } },
        });
        await advance(400);
        rerender({
            actionString: undefined,
            actionData: { params: { DESTINATION: 'bc1qdest', VERSION: '0' }, action: 'SWEEP' },
        });
        await advance(400);
        expect(messaging.quoteProtocolFee).toHaveBeenCalledTimes(1);
    });

    it('requotes after the debounce when a param changes and drops the stale answer', async () => {
        let resolveFirst;
        messaging.quoteProtocolFee = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ xchainFee: '0.7' });
        const { result, rerender } = render({
            actionString: undefined,
            actionData: { action: 'SWAP', params: { AMOUNT: '1' } },
        });
        await advance(400);
        rerender({ actionString: undefined, actionData: { action: 'SWAP', params: { AMOUNT: '2' } } });
        await act(async () => {
            resolveFirst({ xchainFee: '0.3' });
            await Promise.resolve();
        });
        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(399);
        expect(messaging.quoteProtocolFee).toHaveBeenCalledTimes(1);
        await advance(1);
        expect(messaging.quoteProtocolFee).toHaveBeenLastCalledWith(expect.objectContaining({
            actionData: { action: 'SWAP', params: { AMOUNT: '2' } },
        }));
        await waitFor(() => expect(result.current.quote).toEqual({ xchainFee: '0.7' }));
    });

    it('stays pending while the action params are still incomplete', async () => {
        messaging.quoteProtocolFee = vi.fn();
        const { result } = render({ actionString: undefined, actionData: null });
        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(400);
        expect(messaging.quoteProtocolFee).not.toHaveBeenCalled();
    });

    it('settles unpending with no quote when the shell has no quoteProtocolFee', async () => {
        const { result } = render({
            actionString: undefined,
            actionData: { action: 'SWEEP', params: { VERSION: '0' } },
        });
        expect(result.current).toEqual({ quote: null, pending: false });
        await advance(400);
        expect(messaging.requoteNativeFee).not.toHaveBeenCalled();
    });

    it('stays pending, without quoting, until the string and source are both known', async () => {
        const { result, rerender } = render({ actionString: null, actionData: undefined, source: '' });
        expect(result.current).toEqual({ quote: null, pending: true });
        await advance(800);
        expect(messaging.requoteNativeFee).not.toHaveBeenCalled();
        expect(result.current).toEqual({ quote: null, pending: true });
        messaging.requoteNativeFee.mockResolvedValue({ xchainFee: '1' });
        rerender({ actionString: 'DIVIDEND|0|A|B|1', source: BASE.source });
        await advance(400);
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(result.current.quote).toEqual({ xchainFee: '1' });
    });
});
