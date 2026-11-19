// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPriceOracle } from '../../../packages/core/src/flows/priceOracle.js';

const CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
const CACHE_KEYS = [
    'xchain-wallet:price-oracle-spot:v1',
    'xchain-wallet:price-oracle-sparkline:v1',
    'xchain-wallet:price-oracle-history:v1',
];

function response(data) {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => data),
    };
}

function fetchResponse(url) {
    if (url.includes('/simple/price')) {
        return response({
            bitcoin: { usd: 70_000 },
            litecoin: { usd: 80 },
            dogecoin: { usd: 0.1 },
        });
    }
    return response({ prices: [[1, 1], [2, 2]] });
}

function historyCalls(fetch) {
    return fetch.mock.calls.filter(([url]) => url.includes('/market_chart'));
}

beforeEach(() => {
    for (const key of CACHE_KEYS) globalThis.localStorage.removeItem(key);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('priceOracle daily-history staggering', () => {
    it('starts three histories at 0, 1000, and 2000 ms', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const starts = [];
        const fetch = vi.fn(async (url) => {
            if (url.includes('/market_chart')) starts.push(Date.now());
            return fetchResponse(url);
        });
        const oracle = createPriceOracle({ fetch, now: () => Date.now() });

        const pending = oracle.getNativePrices({ chainIds: CHAINS, includeHistory: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(starts).toEqual([0]);
        await vi.advanceTimersByTimeAsync(999);
        expect(starts).toEqual([0]);
        await vi.advanceTimersByTimeAsync(1);
        expect(starts).toEqual([0, 1000]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(starts).toEqual([0, 1000, 2000]);

        await pending;
    });

    it('shares all reserved in-flight histories with a concurrent caller', async () => {
        const sleep = vi.fn(async () => {});
        const fetch = vi.fn(async (url) => fetchResponse(url));
        const oracle = createPriceOracle({ fetch, now: () => 10_000, sleep });
        const request = { chainIds: CHAINS, includeHistory: true };

        const [first, second] = await Promise.all([
            oracle.getNativePrices(request),
            oracle.getNativePrices(request),
        ]);

        expect(historyCalls(fetch)).toHaveLength(3);
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
        expect(second).toEqual(first);
    });

    it('aborts during a stagger wait without fetching the delayed coins', async () => {
        let releaseWait;
        const sleep = vi.fn(() => new Promise((resolve) => { releaseWait = resolve; }));
        const fetch = vi.fn(async (url) => fetchResponse(url));
        const oracle = createPriceOracle({ fetch, now: () => 20_000, sleep });
        const controller = new AbortController();

        const pending = oracle.getNativePrices({
            chainIds: CHAINS,
            includeHistory: true,
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(historyCalls(fetch)).toHaveLength(1);
        releaseWait();
    });
});
