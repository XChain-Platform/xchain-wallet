// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    COINGECKO_SUPPORTED_CHAINS,
    createPriceOracle,
} from '../../../packages/core/src/flows/priceOracle.js';

function response(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn(async () => data),
    };
}

describe('priceOracle', () => {
    it('requires an injected fetch and avoids it for unknown chains', async () => {
        expect(() => createPriceOracle({})).toThrow('fetch is required');
        const fetch = vi.fn();
        const oracle = createPriceOracle({ fetch });

        await expect(oracle.getNativePrices({ chainIds: ['custom-chain'] }))
            .resolves.toEqual({ prices: { 'custom-chain': null } });
        expect(fetch).not.toHaveBeenCalled();
        expect(COINGECKO_SUPPORTED_CHAINS).toContain('bitcoin-regtest');
    });

    it('batches spot prices and caches them by fiat currency', async () => {
        let time = 1000;
        const fetch = vi.fn(async () => response({
            bitcoin: {
                eur: 60000,
                eur_market_cap: 1200000,
                eur_24h_change: -1.25,
            },
            litecoin: {
                eur: 75,
                eur_market_cap: 5000,
                eur_24h_change: 2.5,
            },
        }));
        const oracle = createPriceOracle({ fetch, now: () => time });
        const request = {
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet'],
            fiatCurrency: 'EUR',
        };

        const first = await oracle.getNativePrices(request);
        time += 60_000;
        const second = await oracle.getNativePrices(request);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toContain('ids=bitcoin%2Clitecoin');
        expect(fetch.mock.calls[0][0]).toContain('vs_currencies=eur');
        expect(first.prices['bitcoin-mainnet']).toMatchObject({
            priceFiat: 60000,
            marketCapFiat: 1200000,
            change24hPct: -1.25,
            sparkline: null,
            fetchedAt: 1000,
        });
        expect(second).toEqual(first);
    });

    it('fetches a requested sparkline after a fresh spot-only lookup', async () => {
        let time = 0;
        let spotPrice = 65000;
        let chart = [[1, 64000], [2, 65000]];
        const fetch = vi.fn(async (url) => {
            if (url.includes('/simple/price')) {
                return response({
                    bitcoin: {
                        usd: spotPrice,
                        usd_market_cap: 1000000,
                        usd_24h_change: 1,
                    },
                });
            }
            return response({ prices: chart });
        });
        const oracle = createPriceOracle({ fetch, now: () => time });
        const request = { chainIds: ['bitcoin-mainnet'] };

        await oracle.getNativePrices(request);
        time = 1000;
        const withChart = await oracle.getNativePrices({ ...request, includeSparkline: true });

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][0]).toContain('/coins/bitcoin/market_chart');
        expect(withChart.prices['bitcoin-mainnet'].sparkline).toEqual([64000, 65000]);

        time = 6 * 60 * 1000;
        spotPrice = 66000;
        const refreshedSpot = await oracle.getNativePrices({ ...request, includeSparkline: true });

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(refreshedSpot.prices['bitcoin-mainnet']).toMatchObject({
            priceFiat: 66000,
            sparkline: [64000, 65000],
        });

        time = 61 * 60 * 1000 + 1001;
        chart = [[3, 67000]];
        const refreshedChart = await oracle.getNativePrices({ ...request, includeSparkline: true });

        expect(fetch).toHaveBeenCalledTimes(5);
        expect(refreshedChart.prices['bitcoin-mainnet'].sparkline).toEqual([67000]);
    });

    it('returns cached data with the spot error and retries after clearCache', async () => {
        let time = 0;
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({
                dogecoin: {
                    usd: 0.2,
                    usd_market_cap: 100,
                    usd_24h_change: 3,
                },
            }))
            .mockResolvedValue(response({}, 503));
        const oracle = createPriceOracle({ fetch, now: () => time });
        const request = { chainIds: ['dogecoin-mainnet'] };
        const first = await oracle.getNativePrices(request);

        time = 6 * 60 * 1000;
        const stale = await oracle.getNativePrices(request);

        expect(stale).toEqual({ prices: first.prices, error: 'HTTP 503' });
        oracle.clearCache();
        await expect(oracle.getNativePrices(request)).resolves.toEqual({
            prices: {},
            error: 'HTTP 503',
        });
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});
