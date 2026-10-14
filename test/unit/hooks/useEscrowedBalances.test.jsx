// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's escrow read: merged into the balances once it lands, throttled to one
// read a minute per address set, and a failed read keeps the last good answer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useEscrowedBalances, ESCROW_REFRESH_MS } from '../../../packages/core/src/shared/hooks/useEscrowedBalances.js';

const OWNER = 'tltc1ql05c4je6cjg5ejzyrrr2nxvdr7htmf5eelek37';
const balances = { 'litecoin-testnet': [{ address: OWNER, balances: { tokens: [] } }] };
const active = { 'litecoin-testnet': { address: OWNER } };
const BEER = { rows: [{ tick: 'BEER', amount: '12', offers: { dispenser: 1 } }], partial: false };

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

async function flushPromises() {
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useEscrowedBalances', () => {

    it('merges the escrow read into the shown address\'s entry', async () => {
        const messaging = { getEscrowedTokens: vi.fn(async () => BEER) };
        const { result } = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, balancesFetchedAt: 1, messaging }));
        await flushPromises();
        expect(result.current['litecoin-testnet'][0].balances.escrow).toEqual(BEER.rows);
        expect(messaging.getEscrowedTokens).toHaveBeenCalledWith({ chainId: 'litecoin-testnet', address: OWNER });
    });

    it('polls once per minute without letting balance refreshes restart the interval', async () => {
        const messaging = { getEscrowedTokens: vi.fn(async () => BEER) };
        const { rerender } = renderHook(
            (p) => useEscrowedBalances({ balances, activeByChain: active, balancesFetchedAt: p.at, messaging }),
            { initialProps: { at: 1 } },
        );
        await flushPromises();
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
        rerender({ at: 2 });
        renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging }));
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(ESCROW_REFRESH_MS - 20_001); });
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(2);
    });

    it('keeps the last answer when a later poll fails', async () => {
        const messaging = { getEscrowedTokens: vi.fn()
            .mockResolvedValueOnce(BEER)
            .mockRejectedValueOnce(new Error('429')) };
        const { result } = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging }));
        await flushPromises();
        await act(async () => { await vi.advanceTimersByTimeAsync(ESCROW_REFRESH_MS); });
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(2);
        expect(result.current['litecoin-testnet'][0].balances.escrow).toEqual(BEER.rows);
    });

    it('pauses while hidden and catches up when the app becomes visible', async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        const messaging = { getEscrowedTokens: vi.fn(async () => BEER) };
        renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging }));

        await act(async () => { await vi.advanceTimersByTimeAsync(ESCROW_REFRESH_MS * 2); });
        expect(messaging.getEscrowedTokens).not.toHaveBeenCalled();

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        await act(async () => { await vi.advanceTimersByTimeAsync(ESCROW_REFRESH_MS * 2); });
        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight read across mounts', async () => {
        const pending = deferred();
        const messaging = { getEscrowedTokens: vi.fn(() => pending.promise) };
        const first = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging }));
        const second = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging }));

        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(1);
        pending.resolve(BEER);
        await flushPromises();
        expect(first.result.current['litecoin-testnet'][0].balances.escrow).toEqual(BEER.rows);
        expect(second.result.current['litecoin-testnet'][0].balances.escrow).toEqual(BEER.rows);
    });

    it('passes balances through untouched on a shell without the route', () => {
        const { result } = renderHook(() => useEscrowedBalances({ balances, activeByChain: active, messaging: {} }));
        expect(result.current).toBe(balances);
    });

});
