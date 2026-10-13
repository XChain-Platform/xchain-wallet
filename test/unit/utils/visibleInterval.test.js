// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { startVisibleInterval } from '../../../packages/core/src/shared/utils/visibleInterval.js';
import {
    clearTokenInfoCache,
    readTokenInfoCache,
    tokenInfoCacheKey,
    writeTokenInfoCache,
    TOKEN_INFO_CACHE_MAX,
} from '../../../packages/core/src/shared/utils/tokenInfoCache.js';
import {
    _resetPriceLookupForTests,
    configureFiatRateSource,
    getTokenFiatRate,
    refreshTokenFiatRate,
    TOKEN_RATE_CACHE_MAX,
} from '../../../packages/core/src/flows/priceLookup.js';
import {
    ESCROW_READ_CACHE_MAX,
    useEscrowedBalances,
} from '../../../packages/core/src/shared/hooks/useEscrowedBalances.js';

function setVisibility(value) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
    vi.useFakeTimers();
    _resetPriceLookupForTests();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
    cleanup();
    clearTokenInfoCache();
    _resetPriceLookupForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('memory cache bounds', () => {
    it('evicts least-recently-used metadata and image-bearing records', () => {
        const chainId = 'bitcoin-regtest';
        for (let i = 0; i < TOKEN_INFO_CACHE_MAX; i += 1) {
            writeTokenInfoCache(tokenInfoCacheKey(chainId, `TICK${i}`), {
                images: [{ url: `https://images.test/${i}.png` }],
            });
        }
        expect(readTokenInfoCache(tokenInfoCacheKey(chainId, 'TICK0')).hit).toBe(true);

        writeTokenInfoCache(tokenInfoCacheKey(chainId, 'OVERFLOW'), { images: [] });

        expect(readTokenInfoCache(tokenInfoCacheKey(chainId, 'TICK0')).hit).toBe(true);
        expect(readTokenInfoCache(tokenInfoCacheKey(chainId, 'TICK1')).hit).toBe(false);
        expect(readTokenInfoCache(tokenInfoCacheKey(chainId, 'OVERFLOW')).hit).toBe(true);
    });

    it('evicts least-recently-used token prices', async () => {
        const now = Date.parse('2026-07-27T12:00:00Z');
        let currentTick = '';
        configureFiatRateSource({
            now: () => now,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async () => ({
                ok: true,
                json: async () => ({
                    data: [{
                        coin_pair: `${currentTick}/USD`,
                        price: '1',
                        block_timestamp: Math.floor(now / 1000) - 60,
                        status: 'FINALIZED',
                    }],
                }),
            }),
        });
        for (let i = 0; i < TOKEN_RATE_CACHE_MAX; i += 1) {
            currentTick = `TICK${i}`;
            await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: currentTick, nativeTicker: 'BTC' });
        }
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'TICK0' })).not.toBeNull();

        currentTick = 'OVERFLOW';
        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: currentTick, nativeTicker: 'BTC' });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'TICK0' })).not.toBeNull();
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'TICK1' })).toBeNull();
    });

    it('caps completed history reads per host transport', async () => {
        const messaging = { getEscrowedTokens: vi.fn(async () => ({ rows: [] })) };
        const propsFor = (index) => {
            const address = `address-${index}`;
            return {
                balances: { 'litecoin-testnet': [{ address, balances: { tokens: [] } }] },
                activeByChain: { 'litecoin-testnet': { address } },
            };
        };
        const { rerender } = renderHook(
            ({ index }) => useEscrowedBalances({ ...propsFor(index), messaging }),
            { initialProps: { index: 0 } },
        );
        await act(async () => { await Promise.resolve(); });
        for (let index = 1; index <= ESCROW_READ_CACHE_MAX; index += 1) {
            rerender({ index });
            await act(async () => { await Promise.resolve(); });
        }
        const afterUniqueTargets = messaging.getEscrowedTokens.mock.calls.length;

        rerender({ index: 0 });
        await act(async () => { await Promise.resolve(); });

        expect(messaging.getEscrowedTokens).toHaveBeenCalledTimes(afterUniqueTargets + 1);
    });
});

describe('startVisibleInterval', () => {
    it('removes the timer while hidden and catches up once on resume', () => {
        const callback = vi.fn();
        const stop = startVisibleInterval(callback, 1_000);

        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(1_000);
        expect(callback).toHaveBeenCalledTimes(1);

        setVisibility('hidden');
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(10_000);
        expect(callback).toHaveBeenCalledTimes(1);

        setVisibility('visible');
        expect(callback).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(1_000);
        expect(callback).toHaveBeenCalledTimes(3);

        stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('supports a caller-owned resume action', () => {
        const callback = vi.fn();
        const stop = startVisibleInterval(callback, 1_000, { runOnVisible: false });

        setVisibility('hidden');
        setVisibility('visible');
        expect(callback).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);

        stop();
    });
});
