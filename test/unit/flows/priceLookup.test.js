// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: flows/priceLookup: oracle-primary / CoinGecko-fallback
// source selection, cache semantics, and the sync getFiatRate contract.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getFiatRate,
    refreshFiatRates,
    configureFiatRateSource,
    subscribeFiatRates,
    _resetPriceLookupForTests,
    coinToFiat,
    coinToFiatExact,
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

    it('rehydrates the last known rate synchronously as stale, then replaces it live', async () => {
        let now = NOW;
        let quoted = '50000';
        configureFiatRateSource({
            now: () => now,
            fetch: async () => snapshotResponse([snapshotRow('BTC/USD', quoted)]),
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        const first = getFiatRate({ chainCoin: 'bitcoin' });
        expect(first).toMatchObject({ rate: 50000, stale: false });

        _resetPriceLookupForTests({ preservePersistent: true });
        const cached = getFiatRate({ chainCoin: 'bitcoin' });
        expect(cached).toMatchObject({
            rate: 50000,
            fetchedAt: new Date(NOW).toISOString(),
            stale: true,
        });

        now += 60_000;
        quoted = '51000';
        configureFiatRateSource({
            now: () => now,
            fetch: async () => snapshotResponse([snapshotRow('BTC/USD', quoted, Math.floor(now / 1000) - 60)]),
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toMatchObject({
            rate: 51000,
            fetchedAt: new Date(now).toISOString(),
            stale: false,
        });
    });

    it('ignores corrupt persisted rates instead of flashing a zero price', () => {
        localStorage.setItem('xchain-wallet:fiat-rates:v1', JSON.stringify({
            version: 1,
            rates: [
                { rate: 0, chainCoin: 'bitcoin', fiatCurrency: 'USD', source: 'oracle', fetchedAt: new Date(NOW).toISOString() },
                { rate: 50000, chainCoin: 'litecoin', fiatCurrency: 'USD', source: 'oracle', fetchedAt: 'not-a-date' },
            ],
        }));
        _resetPriceLookupForTests({ preservePersistent: true });

        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();
        expect(getFiatRate({ chainCoin: 'litecoin' })).toBeNull();
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
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { dogecoin: 'https://explorer.test' },
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

    it('rejects an oracle snapshot timestamp far in the future', async () => {
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async () => snapshotResponse([
                snapshotRow('BTC/USD', '999999', Math.floor(NOW / 1000) + 2 * 60 * 60),
            ]),
        });

        await refreshFiatRates({
            chainCoins: ['bitcoin'],
            allowCoingeckoFallback: false,
        });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();
    });

    it('rejects an oracle snapshot that has no usable timestamp', async () => {
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async () => snapshotResponse([{
                coin_pair: 'BTC/USD', price: '999999', status: 'FINALIZED', extra: 'ignored',
            }]),
        });

        await refreshFiatRates({
            chainCoins: ['bitcoin'],
            allowCoingeckoFallback: false,
        });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();
    });

    it('falls back to CoinGecko when the oracle is unreachable', async () => {
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { litecoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { litecoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
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
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
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

    it.each([
        ['invalid JSON', { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }, 1],
        ['HTML error body', { ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } }, 1],
        ['empty 204 body', { ok: true, status: 204, json: async () => { throw new SyntaxError('empty'); } }, 1],
        ['301 response', { ok: false, status: 301, json: async () => ({}) }, 1],
        ['404 response', { ok: false, status: 404, json: async () => ({}) }, 1],
        ['429 response', { ok: false, status: 429, json: async () => ({}) }, 2],
        ['500 response', { ok: false, status: 500, json: async () => ({}) }, 2],
        ['503 response', { ok: false, status: 503, json: async () => ({}) }, 2],
    ])('leaves the price unavailable for %s with bounded requests', async (_label, response, calls) => {
        const fetchImpl = vi.fn(async () => response);
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: fetchImpl,
        });

        await refreshFiatRates({
            chainCoins: ['bitcoin'],
            allowCoingeckoFallback: false,
        });

        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(calls);
    });

    it('conversion helpers keep their contract', () => {
        const rate = { rate: 40000 };
        expect(coinToFiat('0.5', rate)).toBe(20000);
        expect(coinToFiatExact('9007199254740993.01', { ...rate, rate: 1 }))
            .toBe('9007199254740993.01');
        expect(coinToFiat('junk', rate)).toBeNull();
        expect(fiatToCoin('20000', rate)).toBe('0.5');
        expect(fiatToCoin('40000', { rate: 0 })).toBeNull();
    });

    it('fiatToCoin emits grammar-valid fixed-notation amounts, never exponential', () => {
        // Sub-1e-6 coin amounts previously round-tripped to "9e-8" via
        // Number(...).toString(), which the consensus amount grammar rejects.
        const rate = { rate: 110000 };
        expect(fiatToCoin(0.01, rate)).toBe('0.00000009');
        expect(fiatToCoin(110000, rate)).toBe('1');
        expect(fiatToCoin(55000, rate)).toBe('0.5');
        expect(fiatToCoin(0, rate)).toBe('0');

        const grammar = /^[0-9]+(\.[0-9]+)?$/;
        for (const fiat of [0.01, 0.001, 1, 55000, 110000, 999999]) {
            const out = fiatToCoin(fiat, rate);
            expect(out).not.toBeNull();
            expect(out).not.toContain('e');
            expect(grammar.test(out)).toBe(true);
        }
    });

    it('converts finite exponential numbers without losing the decimal grammar', () => {
        expect(coinToFiatExact(1e-8, { rate: 1e-8 })).toBe('0.0000000000000001');
        expect(coinToFiatExact('0.00000001', { rate: 1e21 })).toBe('10000000000000');
        expect(fiatToCoin(1e-8, { rate: 1 }, 8)).toBe('0.00000001');
        expect(fiatToCoin('1', { rate: 1e-8 })).toBe('100000000');
        expect(fiatToCoin('1', { rate: -1 })).toBeNull();
        expect(coinToFiat('2', { rate: 1e308 })).toBeNull();
    });
});
