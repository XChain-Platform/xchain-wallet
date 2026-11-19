// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPriceOracle } from '../../../packages/core/src/flows/priceOracle.js';

const SPOT_KEY = 'xchain-wallet:price-oracle-spot:v1';
const SPARKLINE_KEY = 'xchain-wallet:price-oracle-sparkline:v1';
const NOW = 1_800_000_000_000;

function storedSpot(fetchedAt) {
    return JSON.stringify({
        version: 1,
        entries: [{
            key: 'bitcoin-mainnet|usd',
            priceFiat: 70_000,
            marketCapFiat: 1_400_000,
            change24hPct: 2.5,
            fetchedAt,
        }],
    });
}

function response(data) {
    return { ok: true, status: 200, json: vi.fn(async () => data) };
}

describe('priceOracle persisted cache', () => {
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    beforeEach(() => {
        globalThis.localStorage.clear();
    });

    afterEach(() => {
        if (localStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    });

    it('hydrates a fresh stored entry without fetching', async () => {
        globalThis.localStorage.setItem(SPOT_KEY, storedSpot(NOW - 60_000));
        globalThis.localStorage.setItem(SPARKLINE_KEY, JSON.stringify({
            version: 1,
            entries: [{
                key: 'bitcoin-mainnet|usd',
                sparkline: [68_000, 69_000, 70_000],
                fetchedAt: NOW - 60_000,
            }],
        }));
        const fetch = vi.fn();
        const oracle = createPriceOracle({ fetch, now: () => NOW });

        const result = await oracle.getNativePrices({
            chainIds: ['bitcoin-mainnet'],
            includeSparkline: true,
        });

        expect(fetch).not.toHaveBeenCalled();
        expect(result).toEqual({
            prices: {
                'bitcoin-mainnet': {
                    priceFiat: 70_000,
                    marketCapFiat: 1_400_000,
                    change24hPct: 2.5,
                    sparkline: [68_000, 69_000, 70_000],
                    fetchedAt: NOW - 60_000,
                },
            },
        });
    });

    it('writes successful spot and sparkline fetches to separate caches', async () => {
        const fetch = vi.fn(async (url) => response(url.includes('/market_chart')
            ? { prices: [[1, 71_000], [2, 72_000]] }
            : { bitcoin: { usd: 72_000, usd_market_cap: 1_500_000, usd_24h_change: 1.5 } }));
        const oracle = createPriceOracle({ fetch, now: () => NOW });

        await oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'], includeSparkline: true });

        expect(JSON.parse(globalThis.localStorage.getItem(SPOT_KEY))).toEqual({
            version: 1,
            entries: [{
                key: 'bitcoin-mainnet|usd',
                priceFiat: 72_000,
                marketCapFiat: 1_500_000,
                change24hPct: 1.5,
                fetchedAt: NOW,
            }],
        });
        expect(JSON.parse(globalThis.localStorage.getItem(SPARKLINE_KEY))).toEqual({
            version: 1,
            entries: [{
                key: 'bitcoin-mainnet|usd',
                sparkline: [71_000, 72_000],
                fetchedAt: NOW,
            }],
        });
    });

    it('returns a stale stored entry and starts exactly one refresh', async () => {
        globalThis.localStorage.setItem(SPOT_KEY, storedSpot(NOW - 6 * 60_000));
        const fetch = vi.fn(async () => response({ bitcoin: { usd: 71_000 } }));
        const oracle = createPriceOracle({ fetch, now: () => NOW });

        const result = await oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'] });

        expect(result).toEqual({
            prices: {
                'bitcoin-mainnet': {
                    priceFiat: 70_000,
                    marketCapFiat: 1_400_000,
                    change24hPct: 2.5,
                    sparkline: null,
                    fetchedAt: NOW - 6 * 60_000,
                    stale: true,
                },
            },
        });
        expect(fetch).toHaveBeenCalledTimes(1);
        await oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'] });
        expect(fetch).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('keeps a stale stored entry and suppresses a refresh failure', async () => {
        globalThis.localStorage.setItem(SPOT_KEY, storedSpot(NOW - 6 * 60_000));
        const fetch = vi.fn(async () => { throw new TypeError('offline'); });
        const oracle = createPriceOracle({ fetch, now: () => NOW });

        const result = await oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'] });

        expect(result.error).toBeUndefined();
        expect(result.prices['bitcoin-mainnet']).toMatchObject({ priceFiat: 70_000, stale: true });
        expect(fetch).toHaveBeenCalledTimes(1);
        await oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'] });
        expect(fetch).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('works when localStorage is unavailable', async () => {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
        const fetch = vi.fn(async () => response({ bitcoin: { usd: 72_000 } }));
        const oracle = createPriceOracle({ fetch, now: () => NOW });

        await expect(oracle.getNativePrices({ chainIds: ['bitcoin-mainnet'] })).resolves.toEqual({
            prices: {
                'bitcoin-mainnet': {
                    priceFiat: 72_000,
                    marketCapFiat: null,
                    change24hPct: null,
                    sparkline: null,
                    fetchedAt: NOW,
                },
            },
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
