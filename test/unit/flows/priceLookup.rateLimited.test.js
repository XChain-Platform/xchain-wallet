// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Coin rates when the explorer answers 429. A refusal must not poison the
// cache, must still reach the CoinGecko fallback when the user allows it,
// and must not be re-asked on every Home balance poll while it lasts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getFiatRate,
    refreshFiatRates,
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

const T0 = Date.parse('2026-10-12T12:00:00Z');
const FRESH_TS = Math.floor(T0 / 1000) - 60;

const tooMany = { ok: false, status: 429, json: async () => ({}) };

function source({ oracle, coingecko }) {
    let now = T0;
    const urls = [];
    configureFiatRateSource({
        now: () => now,
        explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        fetch: async (url) => {
            urls.push(url);
            if (url.includes('/api/price_snapshots/')) return oracle();
            return coingecko();
        },
    });
    return { urls, advance: (ms) => { now += ms; } };
}

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('priceLookup under explorer rate limiting', () => {
    it('falls back to CoinGecko when the oracle answers 429', async () => {
        source({ oracle: () => tooMany, coingecko: () => ({ ok: true, json: async () => ({ bitcoin: { usd: 81000 } }) }) });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toMatchObject({ rate: 81000, source: 'coingecko' });
    });

    it('keeps the cached oracle rate when a later refresh is refused', async () => {
        let limited = false;
        const { advance } = source({
            oracle: () => (limited ? tooMany : {
                ok: true,
                json: async () => ({ data: [{ coin_pair: 'BTC/USD', price: '81756', block_timestamp: FRESH_TS }] }),
            }),
            coingecko: () => tooMany,
        });
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        limited = true;
        advance(6 * 60 * 1000);
        await refreshFiatRates({ chainCoins: ['bitcoin'] });
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toMatchObject({ rate: 81756, source: 'oracle' });
    });

    it('waits a minute after a refused refresh before asking again', async () => {
        const { urls, advance } = source({ oracle: () => tooMany, coingecko: () => tooMany });
        await refreshFiatRates({ chainCoins: ['bitcoin'], allowCoingeckoFallback: false });
        expect(urls).toHaveLength(1);
        expect(getFiatRate({ chainCoin: 'bitcoin' })).toBeNull();

        // A balance poll 20 seconds later does not re-ask.
        advance(20 * 1000);
        await refreshFiatRates({ chainCoins: ['bitcoin'], allowCoingeckoFallback: false });
        expect(urls).toHaveLength(1);

        // Past the back-off it does, and force always does.
        advance(45 * 1000);
        await refreshFiatRates({ chainCoins: ['bitcoin'], allowCoingeckoFallback: false });
        expect(urls).toHaveLength(2);
        await refreshFiatRates({ chainCoins: ['bitcoin'], allowCoingeckoFallback: false, force: true });
        expect(urls).toHaveLength(3);
    });
});
