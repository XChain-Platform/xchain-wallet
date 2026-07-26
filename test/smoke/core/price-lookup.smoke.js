// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive fiat conversion + the  oracle wire:
// priceLookup is oracle-primary (explorer price_snapshots) with a
// CoinGecko fallback, and getFiatRate stays a sync cache read.

import { strict as assert } from 'node:assert';
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
const FRESH_TS = Math.floor(NOW / 1000) - 60; // 1 min old snapshot

function oracleResponse(pair, price, tsSec = FRESH_TS) {
    return {
        ok: true,
        json: async () => ({
            data: [{ coin_pair: pair, price: String(price), block_timestamp: tsSec, status: 'FINALIZED' }],
        }),
    };
}

function coingeckoResponse(byId) {
    return { ok: true, json: async () => byId };
}

// --- before refresh: no data, no fabricated numbers (§45.4) ------------

_resetPriceLookupForTests();
assert.equal(getFiatRate({ chainCoin: 'bitcoin' }), null, 'no rate before refresh');
assert.equal(getFiatRate({}), null);
assert.equal(getFiatRate({ chainCoin: '' }), null);

// --- oracle primary ----------------------------------------------------

const calls = [];
configureFiatRateSource({
    now: () => NOW,
    explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
    fetch: async (url) => {
        calls.push(url);
        if (url.startsWith('https://explorer.test/BTC/api/price_snapshots/FINALIZED/status')) {
            return oracleResponse('BTC/USD', '67612.45000000');
        }
        throw new Error('unexpected fetch: ' + url);
    },
});

let notified = 0;
const unsub = subscribeFiatRates(() => { notified += 1; });

await refreshFiatRates({ chainCoins: ['bitcoin'] });
const btc = getFiatRate({ chainCoin: 'bitcoin' });
assert.ok(btc, 'oracle rate cached');
assert.equal(btc.rate, 67612.45);
assert.equal(btc.source, 'oracle');
assert.equal(btc.fiatCurrency, 'USD');
assert.equal(btc.chainCoin, 'bitcoin');
assert.match(btc.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(notified, 1, 'subscriber notified once');
assert.equal(getFiatRate({ chainCoin: 'bitcoin' }), btc, 'stable snapshot reference');

// TTL throttle: an immediate second refresh makes no network call.
const callsBefore = calls.length;
await refreshFiatRates({ chainCoins: ['bitcoin'] });
assert.equal(calls.length, callsBefore, 'fresh cache skips the network');
unsub();

// --- stale oracle feed → CoinGecko fallback ----------------------------

_resetPriceLookupForTests();
const STALE_TS = Math.floor(NOW / 1000) - 2 * 60 * 60; // 2h-old round
configureFiatRateSource({
    now: () => NOW,
    explorerUrlByCoin: { dogecoin: 'https://explorer.test' },
    fetch: async (url) => {
        if (url.includes('/api/price_snapshots/')) return oracleResponse('DOGE/USD', '0.5', STALE_TS);
        if (url.startsWith('https://api.coingecko.com/')) return coingeckoResponse({ dogecoin: { usd: 0.10 } });
        throw new Error('unexpected fetch: ' + url);
    },
});
await refreshFiatRates({ chainCoins: ['dogecoin'] });
const doge = getFiatRate({ chainCoin: 'dogecoin' });
assert.ok(doge);
assert.equal(doge.source, 'coingecko', 'stale oracle falls back');
assert.equal(doge.rate, 0.10);

// --- unreachable oracle → fallback; fallback denied → null -------------

_resetPriceLookupForTests();
configureFiatRateSource({
    now: () => NOW,
    explorerUrlByCoin: { litecoin: 'https://explorer.test' },
    fetch: async (url) => {
        if (url.includes('/api/price_snapshots/')) throw new Error('ECONNREFUSED');
        return coingeckoResponse({ litecoin: { usd: 80 } });
    },
});
await refreshFiatRates({ chainCoins: ['litecoin'], allowCoingeckoFallback: false });
assert.equal(getFiatRate({ chainCoin: 'litecoin' }), null, 'privacy opt-out blocks the fallback');
await refreshFiatRates({ chainCoins: ['litecoin'], force: true });
assert.equal(getFiatRate({ chainCoin: 'litecoin' })?.source, 'coingecko');
assert.equal(getFiatRate({ chainCoin: 'litecoin' })?.rate, 80);

// Both sources down: prior cached rate survives.
configureFiatRateSource({ fetch: async () => { throw new Error('offline'); } });
await refreshFiatRates({ chainCoins: ['litecoin'], force: true });
assert.equal(getFiatRate({ chainCoin: 'litecoin' })?.rate, 80, 'outage keeps last good rate');

// Unknown coin: no oracle URL, no CoinGecko id → stays null.
await refreshFiatRates({ chainCoins: ['monero'], force: true });
assert.equal(getFiatRate({ chainCoin: 'monero' }), null);

// --- conversion helpers (contract unchanged) ---------------------------

const rate40k = { rate: 40000, chainCoin: 'bitcoin', fiatCurrency: 'USD', source: 'oracle', fetchedAt: new Date(NOW).toISOString() };
assert.equal(coinToFiat('1', rate40k), 40000);
assert.equal(coinToFiat('0.5', rate40k), 20000);
assert.equal(coinToFiat(0.001, rate40k), 40, 'numeric input accepted');
assert.equal(coinToFiat('not a number', rate40k), null);
assert.equal(coinToFiat('1', null), null);
assert.equal(coinToFiat('1', { rate: 'oops' }), null);

assert.equal(fiatToCoin('40000', rate40k), '1');
assert.equal(fiatToCoin('20000', rate40k), '0.5');
assert.equal(fiatToCoin('not a number', rate40k), null);
assert.equal(fiatToCoin('-5', rate40k), null, 'negative fiat → null');
assert.equal(fiatToCoin('40000', { rate: 0 }), null, 'zero rate → null');
assert.equal(fiatToCoin('40000', null), null);

const round = fiatToCoin('1234.56', rate40k);
assert.match(round, /^0\.0308\d*/, 'preserves precision to 8 decimals');

_resetPriceLookupForTests();
console.log('price-lookup smoke OK');
