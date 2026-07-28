// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// , the rate-sourcing half. A token amount needs a rate for THAT
// TICK; the chain coin's rate is not an approximation of it, it is a
// different number entirely. These tests pin where a token rate may come
// from (its own oracle pair, else its DEX market against the coin) and,
// just as load-bearing, when the answer must stay null: §45.4 says a
// token with no price shows no fiat, never a fabricated one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getTokenFiatRate,
    refreshTokenFiatRate,
    configureFiatRateSource,
    subscribeFiatRates,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

const NOW = Date.parse('2026-07-27T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const STALE_TS = Math.floor(NOW / 1000) - 30 * 24 * 60 * 60;
const EXPLORER = { bitcoin: 'https://explorer.test' };

function ok(body) {
    return { ok: true, json: async () => body };
}

function snapshotRow(pair, price, tsSec = FRESH_TS) {
    return { coin_pair: pair, price: String(price), block_timestamp: tsSec, status: 'FINALIZED' };
}

function marketRow({ tick1, tick2, tick1_price, tick2_price, tsSec = FRESH_TS }) {
    return { id: 1, tick1, tick2, tick1_price, tick2_price, last_updated: tsSec };
}

/**
 * One fetch impl for both endpoints. `snapshots` answers the oracle
 * feed; `markets` is keyed 'TICK/QUOTE' and answers the market lookup.
 */
function venue({ snapshots = [], markets = {} } = {}) {
    return vi.fn(async (url) => {
        if (url.includes('/api/price_snapshots/')) return ok({ data: snapshots, total: snapshots.length });
        const m = /\/api\/market\/([^/?]+)\/([^/?]+)/.exec(url);
        if (m) {
            const row = markets[`${m[1]}/${m[2]}`];
            return ok({ data: row ? [row] : [] });
        }
        throw new Error(`unexpected url ${url}`);
    });
}

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('flows/priceLookup token rates', () => {
    it('returns null before any refresh, and for a tick nobody asked about', () => {
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toBeNull();
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: '' })).toBeNull();
        expect(getTokenFiatRate({})).toBeNull();
    });

    it('serves a token that has its own oracle pair (XCHAIN/USD)', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42000000')],
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const res = await refreshTokenFiatRate({
            chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC',
        });

        expect(res.updated).toBe(true);
        const rate = getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' });
        expect(rate).toMatchObject({
            rate: 0.42, chainCoin: 'bitcoin', tick: 'XCHAIN', fiatCurrency: 'USD', source: 'oracle',
        });
        // Reference-stable, so it can back a useSyncExternalStore snapshot.
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toBe(rate);
        // The oracle answered, so the market was never asked.
        expect(fetchImpl.mock.calls.some(([url]) => url.includes('/api/market/'))).toBe(false);
    });

    it('falls back to the DEX market, converted through the coin rate', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000')],
            // 0.0000002 BTC per PEPECASH x $100,000/BTC = $0.02
            markets: { 'PEPECASH/BTC': marketRow({ tick1: 'PEPECASH', tick2: 'BTC', tick1_price: '0.00000020', tick2_price: '5000000' }) },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH', nativeTicker: 'BTC' });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' })).toMatchObject({
            rate: 0.02, tick: 'PEPECASH', source: 'market',
        });
    });

    it('reads the price out of a market row stored the other way round', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000')],
            markets: { 'PEPECASH/BTC': marketRow({ tick1: 'BTC', tick2: 'PEPECASH', tick1_price: '5000000', tick2_price: '0.00000020' }) },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'pepecash', nativeTicker: 'btc' });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' })).toMatchObject({ rate: 0.02 });
    });

    it('refuses a market row the indexer stopped keeping up to date', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000')],
            markets: { 'PEPECASH/BTC': marketRow({ tick1: 'PEPECASH', tick2: 'BTC', tick1_price: '0.00000020', tick2_price: '5000000', tsSec: STALE_TS }) },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const res = await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH', nativeTicker: 'BTC' });

        expect(res.updated).toBe(false);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' })).toBeNull();
    });

    it('refuses a market that has never traded (price 0)', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000')],
            markets: { 'NEWTOKEN/BTC': marketRow({ tick1: 'NEWTOKEN', tick2: 'BTC', tick1_price: '0', tick2_price: '0' }) },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'NEWTOKEN', nativeTicker: 'BTC' });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'NEWTOKEN' })).toBeNull();
    });

    it('shows nothing rather than a market price the coin rate cannot convert', async () => {
        // The oracle feed is empty and CoinGecko is refused, so there is no
        // BTC/USD to multiply by. A coin-denominated market price is NOT a
        // fiat rate, and must not be served as one.
        const fetchImpl = venue({
            markets: { 'PEPECASH/BTC': marketRow({ tick1: 'PEPECASH', tick2: 'BTC', tick1_price: '0.00000020', tick2_price: '5000000' }) },
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const res = await refreshTokenFiatRate({
            chainCoin: 'bitcoin', tick: 'PEPECASH', nativeTicker: 'BTC', allowCoingeckoFallback: false,
        });

        expect(res.updated).toBe(false);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' })).toBeNull();
    });

    it('never sources a rate for the native tick, or for a tick it cannot classify', async () => {
        const fetchImpl = venue({ snapshots: [snapshotRow('BTC/USD', '100000')] });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        for (const args of [
            { chainCoin: 'bitcoin', tick: 'BTC', nativeTicker: 'BTC' },
            { chainCoin: 'bitcoin', tick: ' btc ', nativeTicker: 'BTC' },
            { chainCoin: 'bitcoin', tick: '', nativeTicker: 'BTC' },
            // Native ticker unresolved: cannot prove this is not the coin.
            { chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: '' },
            { chainCoin: '', tick: 'XCHAIN', nativeTicker: 'BTC' },
        ]) {
            expect(await refreshTokenFiatRate(args)).toEqual({ updated: false });
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses a tick carrying a path separator instead of pasting it into a URL', async () => {
        const fetchImpl = venue({ snapshots: [snapshotRow('BTC/USD', '100000')] });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        expect(await refreshTokenFiatRate({
            chainCoin: 'bitcoin', tick: '../../api/admin', nativeTicker: 'BTC',
        })).toEqual({ updated: false });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('remembers a miss briefly so a tick being typed does not re-ask per keystroke', async () => {
        const fetchImpl = venue({ snapshots: [snapshotRow('BTC/USD', '100000')] });
        let now = NOW;
        configureFiatRateSource({ now: () => now, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'NOSUCHTOKEN', nativeTicker: 'BTC' });
        const afterFirst = fetchImpl.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'NOSUCHTOKEN', nativeTicker: 'BTC' });
        expect(fetchImpl.mock.calls.length).toBe(afterFirst);

        // A market appearing later is news we still want reasonably soon.
        now = NOW + 2 * 60 * 1000;
        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'NOSUCHTOKEN', nativeTicker: 'BTC' });
        expect(fetchImpl.mock.calls.length).toBeGreaterThan(afterFirst);
    });

    it('throttles a landed token rate on the same TTL as a coin rate', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42')],
        });
        let now = NOW;
        configureFiatRateSource({ now: () => now, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });
        const afterFirst = fetchImpl.mock.calls.length;

        now = NOW + 60 * 1000;
        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });
        expect(fetchImpl.mock.calls.length).toBe(afterFirst);

        now = NOW + 10 * 60 * 1000;
        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });
        expect(fetchImpl.mock.calls.length).toBeGreaterThan(afterFirst);
    });

    it('notifies subscribers when a token rate lands, so mounted views re-render', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42')],
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });
        const seen = vi.fn();
        const unsubscribe = subscribeFiatRates(seen);

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });

        expect(seen).toHaveBeenCalled();
        unsubscribe();
    });

    it('keeps a token rate distinct per chain and per fiat currency', async () => {
        const fetchImpl = venue({
            snapshots: [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42')],
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).not.toBeNull();
        expect(getTokenFiatRate({ chainCoin: 'litecoin', tick: 'XCHAIN' })).toBeNull();
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', fiatCurrency: 'EUR' })).toBeNull();
    });

    it('survives an explorer that answers with garbage', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url.includes('/api/price_snapshots/')) return ok({ data: [snapshotRow('BTC/USD', '100000')] });
            return ok({ data: [{ tick1: null, tick1_price: 'not-a-number' }] });
        });
        configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });

        const res = await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH', nativeTicker: 'BTC' });

        expect(res.updated).toBe(false);
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' })).toBeNull();
    });

    it('keeps a landed rate when a later refresh resolves nothing', async () => {
        let snapshots = [snapshotRow('BTC/USD', '100000'), snapshotRow('XCHAIN/USD', '0.42')];
        let now = NOW;
        configureFiatRateSource({
            now: () => now,
            fetch: (url) => venue({ snapshots })(url),
            explorerUrlByCoin: EXPLORER,
        });
        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toMatchObject({ rate: 0.42 });

        // The feed goes quiet past the TTL. A field that blanks out mid-edit
        // is a worse answer than the price from five minutes ago.
        snapshots = [];
        now = NOW + 10 * 60 * 1000;
        await refreshTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC' });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toMatchObject({ rate: 0.42 });
    });

    it('survives an offline venue without throwing', async () => {
        configureFiatRateSource({
            now: () => NOW,
            fetch: async () => { throw new Error('offline'); },
            explorerUrlByCoin: EXPLORER,
        });

        await expect(refreshTokenFiatRate({
            chainCoin: 'bitcoin', tick: 'XCHAIN', nativeTicker: 'BTC',
        })).resolves.toEqual({ updated: false });
        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'XCHAIN' })).toBeNull();
    });
});
