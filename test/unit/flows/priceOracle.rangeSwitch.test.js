// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Cycling the chart's ranges asks the oracle for the hourly week (24h and 1W)
// and the daily year (1M and longer) over and over. Each series is fetched
// once and then served from its cache while it is fresh, so a switch back to
// 24h after every range costs no network request.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPriceOracle } from '../../../packages/core/src/flows/priceOracle.js';

const SPOT_KEY = 'xchain-wallet:price-oracle-spot:v1';
const SPARKLINE_KEY = 'xchain-wallet:price-oracle-sparkline:v1';
const HISTORY_KEY = 'xchain-wallet:price-oracle-history:v1';
const MINUTE = 60 * 1000;

function response(data) {
    return { ok: true, status: 200, json: vi.fn(async () => data) };
}

function fakeFetch() {
    return vi.fn(async (url) => {
        if (url.includes('/simple/price')) {
            return response({ bitcoin: { usd: 70_000 }, litecoin: { usd: 80 } });
        }
        if (url.includes('days=7')) {
            return response({ prices: Array.from({ length: 168 }, (_, i) => [i * 3_600_000, 69_000 + i]) });
        }
        if (url.includes('days=365')) {
            return response({ prices: Array.from({ length: 366 }, (_, i) => [i * 86_400_000, 50_000 + i]) });
        }
        return response({});
    });
}

function kinds(fetch) {
    const urls = fetch.mock.calls.map(([url]) => url);
    return {
        spot: urls.filter((url) => url.includes('/simple/price')).length,
        hourly: urls.filter((url) => url.includes('days=7')).length,
        daily: urls.filter((url) => url.includes('days=365')).length,
    };
}

describe('priceOracle range switching', () => {
    beforeEach(() => {
        globalThis.localStorage.removeItem(SPOT_KEY);
        globalThis.localStorage.removeItem(SPARKLINE_KEY);
        globalThis.localStorage.removeItem(HISTORY_KEY);
    });

    it('serves the hourly week and daily year from cache on every switch back', async () => {
        const fetch = fakeFetch();
        let clock = 1_000_000;
        const oracle = createPriceOracle({ fetch, now: () => clock });
        const chainIds = ['bitcoin-mainnet', 'litecoin-mainnet'];
        const hourly = () => oracle.getNativePrices({ chainIds, fiatCurrency: 'USD', includeSparkline: true });
        const daily = () => oracle.getNativePrices({ chainIds, fiatCurrency: 'USD', includeHistory: true });

        // 1W opens the chart, then every range in turn and back to 24h, twice.
        const first = await hourly();
        expect(first.prices['bitcoin-mainnet'].sparkline).toHaveLength(168);
        expect(kinds(fetch)).toEqual({ spot: 1, hourly: 2, daily: 0 });

        const year = await daily();
        expect(year.prices['bitcoin-mainnet'].historyDaily).toHaveLength(366);
        expect(kinds(fetch)).toEqual({ spot: 1, hourly: 2, daily: 2 });

        for (let lap = 0; lap < 2; lap += 1) {
            clock += MINUTE;
            const back = await hourly();
            expect(back.prices['bitcoin-mainnet'].sparkline).toHaveLength(168);
            expect(back.prices['litecoin-mainnet'].sparkline).toHaveLength(168);
            clock += MINUTE;
            const again = await daily();
            expect(again.prices['bitcoin-mainnet'].historyDaily).toHaveLength(366);
        }
        expect(kinds(fetch)).toEqual({ spot: 1, hourly: 2, daily: 2 });
    });
});
