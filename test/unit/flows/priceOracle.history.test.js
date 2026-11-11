// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPriceOracle } from '../../../packages/core/src/flows/priceOracle.js';

const SPOT_KEY = 'xchain-wallet:price-oracle-spot:v1';
const SPARKLINE_KEY = 'xchain-wallet:price-oracle-sparkline:v1';
const HISTORY_KEY = 'xchain-wallet:price-oracle-history:v1';
const HOUR = 60 * 60 * 1000;

function response(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn(async () => data),
    };
}

function spotResponse(url) {
    const currency = new URL(url).searchParams.get('vs_currencies');
    return response({
        bitcoin: { [currency]: currency === 'eur' ? 60_000 : 70_000 },
        litecoin: { [currency]: currency === 'eur' ? 70 : 80 },
        dogecoin: { [currency]: currency === 'eur' ? 0.09 : 0.1 },
    });
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function settleBackgroundRefresh() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('priceOracle daily history', () => {
    beforeEach(() => {
        globalThis.localStorage.removeItem(SPOT_KEY);
        globalThis.localStorage.removeItem(SPARKLINE_KEY);
        globalThis.localStorage.removeItem(HISTORY_KEY);
    });

    it('fetches one 365-day series per mainnet coin and filters invalid points', async () => {
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) return spotResponse(url);
            if (url.includes('/coins/bitcoin/')) {
                return response({
                    prices: [
                        [3, Number.POSITIVE_INFINITY],
                        [2, 71_000],
                        [4, 0],
                        [Number.NaN, 72_000],
                        [1, 70_000],
                        [5, -1],
                        [null, 73_000],
                        [6, '74000'],
                    ],
                });
            }
            return response({ prices: [[1, 80], [2, 81]] });
        });
        const oracle = createPriceOracle({ fetch, now: () => 10_000 });

        const result = await oracle.getNativePrices({
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet', 'bitcoin-testnet'],
            fiatCurrency: 'USD',
            includeHistory: true,
        });

        const historyUrls = fetch.mock.calls.map(([url]) => url)
            .filter((url) => url.includes('/market_chart'));
        expect(historyUrls).toHaveLength(2);
        expect(historyUrls.map((url) => new URL(url).pathname)).toEqual([
            '/api/v3/coins/bitcoin/market_chart',
            '/api/v3/coins/litecoin/market_chart',
        ]);
        for (const url of historyUrls) {
            expect(new URL(url).searchParams.get('vs_currency')).toBe('usd');
            expect(new URL(url).searchParams.get('days')).toBe('365');
            expect(new URL(url).searchParams.has('interval')).toBe(false);
        }
        expect(result.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
        expect(result.prices['litecoin-mainnet'].historyDaily).toEqual([[1, 80], [2, 81]]);
        expect(result.prices['bitcoin-testnet']).toBeNull();
    });

    it.each([
        ['empty', []],
        ['all-invalid', [[1, 0], [2, -1], [3, Number.NaN]]],
    ])('returns null history and an error for an %s response', async (_label, prices) => {
        const fetch = vi.fn(async (url) => url.includes('/simple/price')
            ? spotResponse(url)
            : response({ prices }));
        const oracle = createPriceOracle({ fetch, now: () => 20_000 });

        const result = await oracle.getNativePrices({
            chainIds: ['bitcoin-mainnet'],
            includeHistory: true,
        });

        expect(result.prices['bitcoin-mainnet'].historyDaily).toBeNull();
        expect(result.error).toContain('no valid daily price history');
    });

    it('does not fetch daily history by default or for sparkline-only calls', async () => {
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) return spotResponse(url);
            return response({ prices: [[1, 69_000], [2, 70_000]] });
        });
        const oracle = createPriceOracle({ fetch, now: () => 30_000 });

        const spotOnly = await oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'] });
        const sparkline = await oracle.getNativePrices({
            chainIds: ['bitcoin-mainnet'],
            includeSparkline: true,
        });

        expect(spotOnly.prices['bitcoin-mainnet']).not.toHaveProperty('historyDaily');
        expect(sparkline.prices['bitcoin-mainnet'].sparkline).toEqual([69_000, 70_000]);
        expect(fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('days=365'))).toHaveLength(0);
        expect(fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('days=7'))).toHaveLength(1);
    });

    it('caches history for six hours and isolates currencies', async () => {
        let time = 40_000;
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) return spotResponse(url);
            const currency = new URL(url).searchParams.get('vs_currency');
            return response({ prices: currency === 'eur' ? [[1, 60_000], [2, 61_000]] : [[1, 70_000], [2, 71_000]] });
        });
        const oracle = createPriceOracle({ fetch, now: () => time });
        const usdRequest = { chainIds: ['bitcoin-mainnet'], includeHistory: true };

        const first = await oracle.getNativePrices(usdRequest);
        time += 60_000;
        const cached = await oracle.getNativePrices(usdRequest);
        expect(fetch).toHaveBeenCalledTimes(2);
        const eur = await oracle.getNativePrices({ ...usdRequest, fiatCurrency: 'eur' });

        const historyUrls = fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('days=365'));
        expect(historyUrls).toHaveLength(2);
        expect(first.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
        expect(cached.prices['bitcoin-mainnet'].historyDaily).toBe(first.prices['bitcoin-mainnet'].historyDaily);
        expect(eur.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 60_000], [2, 61_000]]);
    });

    it('returns stale history immediately while one background refresh runs', async () => {
        let time = 50_000;
        let historyCall = 0;
        const refresh = deferred();
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) return spotResponse(url);
            historyCall += 1;
            if (historyCall === 1) return response({ prices: [[1, 70_000], [2, 71_000]] });
            return refresh.promise;
        });
        const oracle = createPriceOracle({ fetch, now: () => time });
        const request = { chainIds: ['bitcoin-mainnet'], includeHistory: true };
        await oracle.getNativePrices(request);
        time += 6 * HOUR + 1;

        const stale = await oracle.getNativePrices(request);
        const concurrent = await oracle.getNativePrices(request);

        expect(stale.prices['bitcoin-mainnet']).toMatchObject({
            historyDaily: [[1, 70_000], [2, 71_000]],
            stale: true,
        });
        expect(concurrent.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
        expect(historyCall).toBe(2);
        refresh.resolve(response({ prices: [[3, 72_000], [4, 73_000]] }));
        await settleBackgroundRefresh();
        const updated = await oracle.getNativePrices(request);
        expect(updated.prices['bitcoin-mainnet'].historyDaily).toEqual([[3, 72_000], [4, 73_000]]);
    });

    it('shares a missing in-flight history request across concurrent calls', async () => {
        const pendingHistory = deferred();
        let historyCalls = 0;
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) return spotResponse(url);
            historyCalls += 1;
            return pendingHistory.promise;
        });
        const oracle = createPriceOracle({ fetch, now: () => 60_000 });
        const request = { chainIds: ['bitcoin-mainnet'], includeHistory: true };

        const first = oracle.getNativePrices(request);
        const second = oracle.getNativePrices(request);
        await settleBackgroundRefresh();
        expect(historyCalls).toBe(1);
        pendingHistory.resolve(response({ prices: [[1, 70_000], [2, 71_000]] }));

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
        expect(secondResult).toEqual(firstResult);
    });

    it('keeps the last good series and reports a failed background refresh', async () => {
        let time = 70_000;
        let historyCalls = 0;
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) return spotResponse(url);
            historyCalls += 1;
            return historyCalls === 1
                ? response({ prices: [[1, 70_000], [2, 71_000]] })
                : response({}, 400);
        });
        const oracle = createPriceOracle({ fetch, now: () => time });
        const request = { chainIds: ['bitcoin-mainnet'], includeHistory: true };
        await oracle.getNativePrices(request);
        time += 6 * HOUR + 1;

        const stale = await oracle.getNativePrices(request);
        expect(stale.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
        await settleBackgroundRefresh();
        const afterFailure = await oracle.getNativePrices(request);

        expect(afterFailure.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
        expect(afterFailure.error).toBe('HTTP 400');
        expect(historyCalls).toBe(2);
    });

    it('hydrates persisted history in a fresh oracle without fetching', async () => {
        const fetch = vi.fn(async (url) => url.includes('/simple/price')
            ? spotResponse(url)
            : response({ prices: [[1, 70_000], [2, 71_000]] }));
        const first = createPriceOracle({ fetch, now: () => 80_000 });
        await first.getNativePrices({ chainIds: ['bitcoin-mainnet'], includeHistory: true });
        const persisted = JSON.parse(globalThis.localStorage.getItem(HISTORY_KEY));
        expect(persisted).toEqual({
            version: 1,
            entries: [{
                key: 'bitcoin-mainnet|usd',
                points: [[1, 70_000], [2, 71_000]],
                fetchedAt: 80_000,
            }],
        });

        const freshFetch = vi.fn();
        const fresh = createPriceOracle({ fetch: freshFetch, now: () => 81_000 });
        const result = await fresh.getNativePrices({ chainIds: ['bitcoin-mainnet'], includeHistory: true });

        expect(freshFetch).not.toHaveBeenCalled();
        expect(result.prices['bitcoin-mainnet'].historyDaily).toEqual([[1, 70_000], [2, 71_000]]);
    });

    it('drops every corrupt persisted entry and clearCache removes the history key', async () => {
        globalThis.localStorage.setItem(HISTORY_KEY, JSON.stringify({
            version: 1,
            entries: [
                { key: 'bad-key', points: [[1, 1], [2, 2]], fetchedAt: 90_000 },
                { key: 'bitcoin-mainnet|usd', points: [[2, 1], [1, 2]], fetchedAt: 90_000 },
                { key: 'litecoin-mainnet|usd', points: [[1, 1], [2, 0]], fetchedAt: 90_000 },
                { key: 'dogecoin-mainnet|usd', points: [[1, 1]], fetchedAt: 90_000 },
                { key: 'bitcoin-mainnet|eur', points: [[1, 1], [2, 2]], fetchedAt: Number.NaN },
            ],
        }));
        const oracle = createPriceOracle({ fetch: vi.fn(), now: () => 100_000 });

        await oracle.getNativePrices({ chainIds: ['custom-chain'], includeHistory: true });
        expect(JSON.parse(globalThis.localStorage.getItem(HISTORY_KEY))).toEqual({ version: 1, entries: [] });

        globalThis.localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, entries: [] }));
        oracle.clearCache();
        expect(globalThis.localStorage.getItem(HISTORY_KEY)).toBeNull();
    });
});
