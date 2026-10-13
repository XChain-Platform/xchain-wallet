// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's native rows on a real wallet arrive from the balance read with no
// price, and nothing attached one, so the hero showed "$0.00" and counted
// every coin as unpriced while the oracle was healthy. These tests pin the
// two pieces that price them: the multi-coin hook and the row overlay.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
    useFiatRate,
    useNativeFiatRates,
    priceNativeRows,
} from '../../../packages/core/src/shared/hooks/useFiatRate.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const EXPLORER = {
    bitcoin: 'https://explorer.test',
    litecoin: 'https://explorer.test',
    dogecoin: 'https://explorer.test',
};
const PAIR_BY_PATH = { '/BTC/': 'BTC/USD', '/LTC/': 'LTC/USD', '/DOGE/': 'DOGE/USD' };
const PRICE_BY_PAIR = { 'BTC/USD': '81756.12', 'LTC/USD': '95.5', 'DOGE/USD': '0.21' };

function venue() {
    const calls = [];
    configureFiatRateSource({
        now: () => NOW,
        explorerUrlByCoin: EXPLORER,
        fetch: async (url) => {
            calls.push(url);
            const key = Object.keys(PAIR_BY_PATH).find((k) => url.includes(k));
            if (!key || !url.includes('/api/price_snapshots/FINALIZED/status')) {
                throw new Error(`unexpected url ${url}`);
            }
            const pair = PAIR_BY_PATH[key];
            return {
                ok: true,
                json: async () => ({ data: [{ coin_pair: pair, price: PRICE_BY_PAIR[pair], block_timestamp: FRESH_TS }] }),
            };
        },
    });
    return calls;
}

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('useNativeFiatRates', () => {
    it('returns the oracle rate for every requested coin, keyed by family', async () => {
        venue();
        const { result } = renderHook(() => useNativeFiatRates({ chainCoins: ['bitcoin', 'litecoin', 'dogecoin'] }));

        await waitFor(() => expect(Object.keys(result.current)).toHaveLength(3));
        expect(result.current.bitcoin).toMatchObject({ rate: 81756.12, source: 'oracle' });
        expect(result.current.litecoin.rate).toBe(95.5);
        expect(result.current.dogecoin.rate).toBe(0.21);
    });

    it('fetches nothing for an empty coin list', async () => {
        const calls = venue();
        const { result } = renderHook(() => useNativeFiatRates({ chainCoins: [] }));
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current).toEqual({});
        expect(calls).toEqual([]);
    });

    it('shares one request across mounted consumers and refetches once per currency switch', async () => {
        const calls = [];
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: EXPLORER,
            fetch: async (url) => {
                calls.push(url);
                if (url.includes('vs_currencies=eur')) {
                    return { ok: true, json: async () => ({ bitcoin: { eur: 70000 } }) };
                }
                return {
                    ok: true,
                    json: async () => ({ data: [{ coin_pair: 'BTC/USD', price: '81756.12', block_timestamp: FRESH_TS }] }),
                };
            },
        });
        const { result, rerender } = renderHook(({ fiatCurrency }) => ({
            home: useNativeFiatRates({ chainCoins: ['bitcoin'], fiatCurrency }).bitcoin,
            detail: useFiatRate({ chainCoin: 'bitcoin', fiatCurrency }),
        }), { initialProps: { fiatCurrency: 'USD' } });

        await waitFor(() => expect(result.current.home?.rate).toBe(81756.12));
        expect(result.current.detail?.rate).toBe(81756.12);
        expect(calls.filter((url) => url.includes('/api/price_snapshots/'))).toHaveLength(1);

        rerender({ fiatCurrency: 'EUR' });
        await waitFor(() => expect(result.current.home?.rate).toBe(70000));
        expect(result.current.detail?.rate).toBe(70000);
        expect(calls.filter((url) => url.includes('vs_currencies=eur'))).toHaveLength(1);
    });

    it('keeps the stale rate visible while its revalidation is pending', async () => {
        let now = NOW;
        let release;
        let nextPrice = '80000';
        let hold = false;
        configureFiatRateSource({
            now: () => now,
            explorerUrlByCoin: EXPLORER,
            fetch: async () => {
                if (hold) await new Promise((resolve) => { release = resolve; });
                return {
                    ok: true,
                    json: async () => ({ data: [{ coin_pair: 'BTC/USD', price: nextPrice, block_timestamp: FRESH_TS }] }),
                };
            },
        });
        const { result, rerender } = renderHook(({ refreshKey }) => useNativeFiatRates({
            chainCoins: ['bitcoin'],
            refreshKey,
        }), { initialProps: { refreshKey: 0 } });

        await waitFor(() => expect(result.current.bitcoin?.rate).toBe(80000));
        now += 6 * 60 * 1000;
        nextPrice = '81000';
        hold = true;
        rerender({ refreshKey: 1 });

        expect(result.current.bitcoin?.rate).toBe(80000);
        await waitFor(() => expect(release).toBeTypeOf('function'));
        release();
        await waitFor(() => expect(result.current.bitcoin?.rate).toBe(81000));
    });
});

describe('priceNativeRows', () => {
    const rates = { bitcoin: { rate: 80000 }, litecoin: { rate: 90 } };
    const row = (over) => ({ kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC', quantity: '0', divisibility: 8, fiatRate: null, ...over });

    it('attaches the coin rate to a native row with none, zero balance included', () => {
        const [btc, ltc] = priceNativeRows(
            [row(), row({ chainId: 'litecoin-testnet', tick: 'LTC' })],
            rates,
        );
        expect(btc.fiatRate).toBe(80000);
        expect(ltc.fiatRate).toBe(90);
    });

    it('keeps a rate the row already has, which is how demo fixtures price themselves', () => {
        const [btc] = priceNativeRows([row({ fiatRate: 95000 })], rates);
        expect(btc.fiatRate).toBe(95000);
    });

    it('never prices a token with its chain coin rate', () => {
        const [tok] = priceNativeRows([row({ kind: 'token', tick: 'XCP' })], rates);
        expect(tok.fiatRate).toBeNull();
    });

    it('leaves a row whose balance could not be read at all unpriced', () => {
        const [btc] = priceNativeRows([row({ unavailable: 'all' })], rates);
        expect(btc.fiatRate).toBeNull();
        const [partial] = priceNativeRows([row({ unavailable: 'partial' })], rates);
        expect(partial.fiatRate).toBe(80000);
    });

    it('leaves a coin with no known rate unpriced and returns the same array', () => {
        const rows = [row({ chainId: 'dogecoin-mainnet', tick: 'DOGE' })];
        expect(priceNativeRows(rows, rates)).toBe(rows);
    });
});
