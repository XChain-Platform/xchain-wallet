// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// refreshTokenFiatRates: Home's batch of token rates. Its reads follow the
// chains, never the tokens: one oracle snapshot read and one paged read of
// every market against the coin per coin family. Each token keeps the single
// path's rules (its oracle pair first, else its market converted through the
// coin rate, else no number), and only the asked-for ticks are written.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getTokenFiatRate,
    isFiatRateSourceUrl,
    refreshTokenFiatRate,
    refreshTokenFiatRates,
    configureFiatRateSource,
    subscribeFiatRates,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const STALE_TS = Math.floor(NOW / 1000) - 30 * 24 * 60 * 60;
const EXPLORER = { bitcoin: 'https://explorer.test', litecoin: 'https://ltc.explorer.test' };

function ok(body) {
    return { ok: true, json: async () => body };
}

function snapshotRow(pair, price, tsSec = FRESH_TS) {
    return { coin_pair: pair, price: String(price), block_timestamp: tsSec, status: 'FINALIZED' };
}

function marketRow(tick, quote, price, { tsSec = FRESH_TS, reversed = false, change = null } = {}) {
    return reversed
        ? { tick1: quote, tick2: tick, tick1_price: String(1 / Number(price)), tick2_price: String(price), last_updated: tsSec, tick2_24hr_change: change }
        : { tick1: tick, tick2: quote, tick1_price: String(price), tick2_price: String(1 / Number(price)), last_updated: tsSec, tick1_24hr_change: change };
}

/** `snapshots` per coin ticker; `pages` per coin ticker, each an array of market pages. */
function venue({ snapshots = {}, pages = {}, totals = {} } = {}) {
    return vi.fn(async (url) => {
        const snap = /\/(BTC|LTC)\/api\/price_snapshots\/FINALIZED\/status/.exec(url);
        if (snap) return ok({ data: snapshots[snap[1]] || [] });
        // The explorer's getMarkets ignores ?page=, so the venue serves the
        // first page whatever is asked, as the real reader does.
        const markets = /\/(BTC|LTC)\/api\/markets\/([^/?]+)\?limit=(\d+)$/.exec(url);
        if (markets) {
            const list = pages[markets[1]] || [];
            const total = totals[markets[1]] ?? list.reduce((n, rows) => n + rows.length, 0);
            return ok({ data: list[0] || [], total });
        }
        throw new Error(`unexpected url ${url}`);
    });
}

const kinds = (fetchImpl) => fetchImpl.mock.calls.map(([url]) => (
    url.includes('/api/price_snapshots/') ? 'snapshot'
        : url.includes('/api/markets/') ? 'markets'
            : url.includes('/api/market/') ? 'single-market' : url
));

const token = (tick, chainCoin = 'bitcoin', nativeTicker = 'BTC') => ({ chainCoin, tick, nativeTicker });

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('flows/priceLookup refreshTokenFiatRates', () => {
    it('prices oracle and market tokens from one snapshot and one markets read', async () => {
        const fetchImpl = venue({
            snapshots: { BTC: [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42')] },
            pages: { BTC: [[
                marketRow('PEPECASH', 'BTC', '0.0000002', { change: '-3.5' }),
                marketRow('RAREPEPE', 'BTC', '0.01', { reversed: true }),
                // Not asked for: the batch must not price it.
                marketRow('OTHER', 'BTC', '0.5'),
            ]] },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const res = await refreshTokenFiatRates({
            tokens: [token('XCHAIN'), token('pepecash'), token('RAREPEPE'), token('NOMARKET')],
        });

        expect(kinds(fetchImpl)).toEqual(['snapshot', 'markets']);
        expect(fetchImpl.mock.calls[1][0]).toBe('https://explorer.test/BTC/api/markets/BTC?limit=100');
        expect(res.updated.sort()).toEqual(['bitcoin|PEPECASH', 'bitcoin|RAREPEPE', 'bitcoin|XCHAIN']);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toMatchObject({ rate: 0.42, source: 'oracle' });
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' })).toMatchObject({
            rate: 0.02, source: 'market', change24hPct: -3.5,
        });
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'RAREPEPE' })).toMatchObject({ rate: 1000, source: 'market' });
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'NOMARKET' })).toBeNull();
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'OTHER' })).toBeNull();
    });

    it('keeps the read count flat from 5 tokens to 50', async () => {
        const counts = [];
        for (const n of [5, 50]) {
            _resetPriceLookupForTests();
            const ticks = Array.from({ length: n }, (_, i) => `T${i}`);
            const fetchImpl = venue({
                snapshots: { BTC: [snapshotRow('BTC/USD', '100000')] },
                pages: { BTC: [ticks.map((tick) => marketRow(tick, 'BTC', '0.000001'))] },
            });
            configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });
            const res = await refreshTokenFiatRates({ tokens: ticks.map((tick) => token(tick)) });
            expect(res.updated).toHaveLength(n);
            counts.push(fetchImpl.mock.calls.length);
        }
        expect(counts).toEqual([2, 2]);
    });

    it('reads each chain once: two coin families cost two snapshot and two markets reads', async () => {
        const fetchImpl = venue({
            snapshots: { BTC: [snapshotRow('BTC/USD', '100000')], LTC: [snapshotRow('LTC/USD', '100')] },
            pages: {
                BTC: [[marketRow('A', 'BTC', '0.000001'), marketRow('B', 'BTC', '0.000002')]],
                LTC: [[marketRow('C', 'LTC', '0.5')]],
            },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRates({
            tokens: [token('A'), token('B'), token('C', 'litecoin', 'LTC')],
        });

        expect(kinds(fetchImpl).sort()).toEqual(['markets', 'markets', 'snapshot', 'snapshot']);
        expect(getTokenFiatRate({ chainCoin: 'litecoin', tick: 'C' })).toMatchObject({ rate: 50 });
    });

    it('reads one markets page however many markets the chain has, and leaves a tick past it unpriced', async () => {
        const full = Array.from({ length: 100 }, (_, i) => marketRow(`X${i}`, 'BTC', '0.000001'));
        const fetchImpl = venue({
            snapshots: { BTC: [snapshotRow('BTC/USD', '100000')] },
            pages: { BTC: [full, [marketRow('OLDER', 'BTC', '0.000003')]] },
            totals: { BTC: 2000 },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRates({ tokens: [token('X3'), token('OLDER')] });

        expect(kinds(fetchImpl)).toEqual(['snapshot', 'markets']);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'X3' }).rate).toBeCloseTo(0.1, 10);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'OLDER' })).toBeNull();
    });

    it('refuses a stale market row, as the single lookup does', async () => {
        const fetchImpl = venue({
            snapshots: { BTC: [snapshotRow('BTC/USD', '100000')] },
            pages: { BTC: [[marketRow('OLD', 'BTC', '0.01', { tsSec: STALE_TS })]] },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRates({ tokens: [token('OLD')] });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'OLD' })).toBeNull();
    });

    it('reads nothing again while the rates are fresh or a miss is remembered', async () => {
        const fetchImpl = venue({
            snapshots: { BTC: [snapshotRow('BTC/USD', '100000')] },
            pages: { BTC: [[marketRow('A', 'BTC', '0.000001')]] },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const tokens = [token('A'), token('MISSING')];
        await refreshTokenFiatRates({ tokens });
        const after = fetchImpl.mock.calls.length;
        await refreshTokenFiatRates({ tokens });
        expect(fetchImpl.mock.calls.length).toBe(after);

        // force re-reads, still once per chain.
        await refreshTokenFiatRates({ tokens, force: true });
        expect(fetchImpl.mock.calls.length - after).toBe(2);
    });

    it('skips the native tick, an unclassifiable tick and a tick carrying a path separator', async () => {
        const fetchImpl = venue({ snapshots: { BTC: [snapshotRow('BTC/USD', '100000')] } });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const res = await refreshTokenFiatRates({
            tokens: [token('BTC'), token('ODD', 'bitcoin', ''), token('A/B'), token(''), null],
        });

        expect(res).toEqual({ updated: [] });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('goes straight to the markets for a non-USD currency', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url.startsWith('https://api.coingecko.com')) return ok({ bitcoin: { eur: 90000 } });
            if (url.includes('/api/markets/')) return ok({ data: [marketRow('A', 'BTC', '0.000001')], total: 1 });
            throw new Error(`unexpected url ${url}`);
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRates({ tokens: [token('A')], fiatCurrency: 'EUR' });

        expect(fetchImpl.mock.calls.some(([url]) => url.includes('/api/price_snapshots/'))).toBe(false);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'A', fiatCurrency: 'EUR' })).toMatchObject({ rate: 0.09 });
    });

    it('joins a single-token refresh already in flight instead of reading it again', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const fetchImpl = vi.fn(async () => {
            await gate;
            return ok({ data: [snapshotRow('XCHAIN/USD', '0.42')] });
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const single = refreshTokenFiatRate(token('XCHAIN'));
        const batch = refreshTokenFiatRates({ tokens: [token('XCHAIN')] });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        release();
        await Promise.all([single, batch]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toMatchObject({ rate: 0.42 });
    });

    it('answers a single-token caller that joins a batch with that tick\'s own yes or no', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const fetchImpl = vi.fn(async (url) => {
            await gate;
            if (url.includes('/api/markets/')) return ok({ data: [], total: 0 });
            return ok({ data: [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42')] });
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const batch = refreshTokenFiatRates({ tokens: [token('XCHAIN'), token('NOMARKET')] });
        const priced = refreshTokenFiatRate(token('XCHAIN'));
        const missed = refreshTokenFiatRate(token('NOMARKET'));
        release();

        await expect(priced).resolves.toEqual({ updated: true });
        await expect(missed).resolves.toEqual({ updated: false });
        await expect(batch).resolves.toEqual({ updated: ['bitcoin|XCHAIN'] });
        // The single callers joined the batch's reads instead of their own.
        expect(kinds(fetchImpl)).toEqual(['snapshot', 'markets']);
    });

    it('tells subscribers once per batch, not once per token', async () => {
        const fetchImpl = venue({
            snapshots: { BTC: [snapshotRow('BTC/USD', '100000')] },
            pages: { BTC: [['A', 'B', 'C'].map((tick) => marketRow(tick, 'BTC', '0.000001'))] },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });
        // Price the coin first so only the token batch is counted.
        await refreshTokenFiatRates({ tokens: [token('WARM')] });
        const listener = vi.fn();
        const unsubscribe = subscribeFiatRates(listener);

        await refreshTokenFiatRates({ tokens: [token('A'), token('B'), token('C')] });

        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('is a fiat-rate source the desktop and extension forwarders accept', () => {
        configureFiatRateSource({ explorerUrlByCoin: EXPLORER });
        expect(isFiatRateSourceUrl('https://explorer.test/BTC/api/markets/BTC?limit=100')).toBe(true);
        expect(isFiatRateSourceUrl('https://explorer.test/BTC/api/markets/BTC/extra')).toBe(false);
        expect(isFiatRateSourceUrl('https://elsewhere.test/BTC/api/markets/BTC')).toBe(false);
    });
});
