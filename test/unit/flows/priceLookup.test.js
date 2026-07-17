// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: flows/priceLookup:  oracle-primary / CoinGecko-fallback
// source selection, cache semantics, and the sync getFiatRate contract.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getFiatRate,
    refreshFiatRates,
    configureFiatRateSource,
    subscribeFiatRates,
    _resetPriceLookupForTests,
    coinToFiat,
    fiatToCoin,
} from '../../../packages/core/src/flows/priceLookup.js';

const NOW = Date.parse('2026-07-17T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const STALE_TS = Math.floor(NOW / 1000) - 2 * 60 * 60;

function snapshotResponse(rows) {
    return { ok: true, json: async () => ({ data: rows, total: rows.length }) };
}

function snapshotRow(pair, price, tsSec = FRESH_TS) {
    return { coin_pair: pair, price: String(price), block_timestamp: tsSec, status: 'FINALIZED' };
}

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('flows/priceLookup', () => {
    it('returns null before any refresh (no fabricated numbers, §45.4)', () => {
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();
        expect(getFiatRate({})).toBeNull();
    });

    it('serves a fresh finalized oracle snapshot as the primary source', async () => {
        const fetchImpl = vi.fn(async (url) => {
            expect(url).toContain('https://explorer.test/BTC/api/price_snapshots/FINALIZED/status');
            return snapshotResponse([
                snapshotRow('LTC/USD', '80'),
                snapshotRow('BTC/USD', '67612.45000000'),
            ]);
        });
        configureFiatRateSource({
            now: () => NOW,
            fetch: fetchImpl,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test/BTC' },
        });
        const res = await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(res.updated).toEqual(['bitcoin']);
        const rate = getFiatRate({ chainCoin: 'bitcoin' });
        expect(rate).toMatchObject({
            rate: 67612.45,
            chainCoin: 'bitcoin',
            fiatCurrency: 'USD',
            source: 'oracle',
        });
        // Stable reference for useSyncExternalStore snapshots.
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBe(rate);
    });

    it('throttles refreshes inside the TTL and honors force', async () => {
        const fetchImpl = vi.fn(async () => snapshotResponse([snapshotRow('BTC/USD', '50000')]));
        configureFiatRateSource({
            now: () => NOW,
            fetch: fetchImpl,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test/BTC' },
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await refreshFiatRates({ chainCoins: ['bitcoin'], force: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('falls back to CoinGecko when the oracle feed is stale', async () => {
        const urls = [];
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { dogecoin: 'https://explorer.test/DOGE' },
            fetch: async (url) => {
                urls.push(url);
                if (url.includes('/api/price_snapshots/')) {
                    return snapshotResponse([snapshotRow('DOGE/USD', '0.5', STALE_TS)]);
                }
                return { ok: true, json: async () => ({ dogecoin: { usd: 0.1 } }) };
            },
        });
        await refreshFiatRates({ chainCoins: ['dogecoin'] });
        expect(getFiatRate({ chainCoin: 'dogecoin' })).toMatchObject({ rate: 0.1, source: 'coingecko' });
        expect(urls.some((u) => u.startsWith('https://api.coingecko.com/'))).toBe(true);
    });

    it('falls back to CoinGecko when the oracle is unreachable', async () => {
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { litecoin: 'https://explorer.test/LTC' },
            fetch: async (url) => {
                if (url.includes('/api/price_snapshots/')) throw new Error('ECONNREFUSED');
                return { ok: true, json: async () => ({ litecoin: { usd: 80 } }) };
            },
        });
        await refreshFiatRates({ chainCoins: ['litecoin'] });
        expect(getFiatRate({ chainCoin: 'litecoin' })).toMatchObject({ rate: 80, source: 'coingecko' });
    });

    it('never hits CoinGecko when the fallback is disallowed (privacy opt-out)', async () => {
        const urls = [];
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { litecoin: 'https://explorer.test/LTC' },
            fetch: async (url) => {
                urls.push(url);
                throw new Error('down');
            },
        });
        await refreshFiatRates({ chainCoins: ['litecoin'], allowCoingeckoFallback: false });
        expect(getFiatRate({ chainCoin: 'litecoin' })).toBeNull();
        expect(urls.every((u) => !u.includes('coingecko'))).toBe(true);
    });

    it('skips the oracle for non-USD currencies (USD-only feed)', async () => {
        const urls = [];
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test/BTC' },
            fetch: async (url) => {
                urls.push(url);
                return { ok: true, json: async () => ({ bitcoin: { eur: 60000 } }) };
            },
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'], fiatCurrency: 'EUR' });
        expect(urls.every((u) => !u.includes('/api/price_snapshots/'))).toBe(true);
        expect(getFiatRate({ chainCoin: 'bitcoin', fiatCurrency: 'EUR' }))
            .toMatchObject({ rate: 60000, source: 'coingecko', fiatCurrency: 'EUR' });
        expect(getFiatRate({ chainCoin: 'bitcoin', fiatCurrency: 'USD' })).toBeNull();
    });

    it('keeps the last good rate through a total outage', async () => {
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test/BTC' },
            fetch: async () => snapshotResponse([snapshotRow('BTC/USD', '50000')]),
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        configureFiatRateSource({ fetch: async () => { throw new Error('offline'); } });
        await refreshFiatRates({ chainCoins: ['bitcoin'], force: true });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toMatchObject({ rate: 50000, source: 'oracle' });
    });

    it('notifies subscribers exactly when the cache changes', async () => {
        const listener = vi.fn();
        const unsub = subscribeFiatRates(listener);
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test/BTC' },
            fetch: async () => snapshotResponse([snapshotRow('BTC/USD', '50000')]),
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(listener).toHaveBeenCalledTimes(1);
        await refreshFiatRates({ chainCoins: ['bitcoin'] }); // TTL skip
        expect(listener).toHaveBeenCalledTimes(1);
        unsub();
        await refreshFiatRates({ chainCoins: ['bitcoin'], force: true });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed oracle prices', async () => {
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test/BTC' },
            fetch: async (url) => {
                if (url.includes('/api/price_snapshots/')) {
                    return snapshotResponse([snapshotRow('BTC/USD', 'not-a-number')]);
                }
                throw new Error('no fallback in this test');
            },
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();
    });

    it('conversion helpers keep their contract', () => {
        const rate = { rate: 40000 };
        expect(coinToFiat('0.5', rate)).toBe(20000);
        expect(coinToFiat('junk', rate)).toBeNull();
        expect(fiatToCoin('20000', rate)).toBe('0.5');
        expect(fiatToCoin('40000', { rate: 0 })).toBeNull();
    });
});
