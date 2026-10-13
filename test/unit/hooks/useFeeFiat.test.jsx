// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const { unsubscribeSpies } = vi.hoisted(() => ({ unsubscribeSpies: [] }));

vi.mock('../../../packages/core/src/flows/priceLookup.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        subscribeFiatRates(listener) {
            const unsubscribe = vi.fn(actual.subscribeFiatRates(listener));
            unsubscribeSpies.push(unsubscribe);
            return unsubscribe;
        },
    };
});

const { useFeeFiat } = await import(
    '../../../packages/core/src/shared/hooks/useFeeFiat.js'
);
const {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} = await import('../../../packages/core/src/flows/priceLookup.js');

const NOW = Date.parse('2026-10-12T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const EXPLORER = {
    bitcoin: 'https://bitcoin.explorer.test',
    litecoin: 'https://litecoin.explorer.test',
};

function venue() {
    const calls = [];
    configureFiatRateSource({
        now: () => NOW,
        explorerUrlByCoin: EXPLORER,
        fetch: async (url) => {
            calls.push(url);
            if (url.includes('/api/price_snapshots/FINALIZED/status')) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [
                            { coin_pair: 'BTC/USD', price: '100000', block_timestamp: FRESH_TS },
                            { coin_pair: 'LTC/USD', price: '100', block_timestamp: FRESH_TS },
                            { coin_pair: 'XCHAIN/USD', price: '0.40', block_timestamp: FRESH_TS },
                        ],
                    }),
                };
            }
            if (url.includes('api.coingecko.com')) {
                return { ok: true, json: async () => ({ bitcoin: { eur: 90000 } }) };
            }
            throw new Error(`unexpected url ${url}`);
        },
    });
    return calls;
}

const options = (overrides = {}) => ({
    chainCoin: 'bitcoin',
    nativeTicker: 'BTC',
    settings: { fiatCurrency: 'USD', privacy: { priceDataEnabled: true } },
    ...overrides,
});

beforeEach(() => {
    unsubscribeSpies.length = 0;
    _resetPriceLookupForTests();
});

afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
    vi.clearAllMocks();
});

describe('useFeeFiat', () => {
    it('formats native and protocol fees with their own rates', async () => {
        venue();
        const { result } = renderHook(() => useFeeFiat(options()));

        await waitFor(() => {
            expect(result.current.formatNativeFee('0.00001')).toBe('≈ $1.00 USD');
            expect(result.current.formatProtocolFee('5')).toBe('≈ $2.00 USD');
        });

        expect(result.current.formatNativeFee('0')).toBeNull();
        expect(result.current.formatNativeFee('not-a-number')).toBeNull();
    });

    it('refreshes formatters when chain and currency parameters change', async () => {
        const calls = venue();
        const { result, rerender } = renderHook(
            (props) => useFeeFiat(props),
            { initialProps: options() },
        );

        await waitFor(() => expect(result.current.formatNativeFee('0.00001')).toBe('≈ $1.00 USD'));
        const bitcoinFormatter = result.current.formatNativeFee;

        rerender(options({ chainCoin: 'litecoin', nativeTicker: 'LTC' }));
        await waitFor(() => expect(result.current.formatNativeFee('0.01')).toBe('≈ $1.00 USD'));
        expect(result.current.formatNativeFee).not.toBe(bitcoinFormatter);

        rerender(options({
            settings: { fiatCurrency: 'EUR', privacy: { priceDataEnabled: true } },
        }));
        await waitFor(() => expect(result.current.formatNativeFee('0.00001')).toBe('≈ €0.90 EUR'));
        expect(result.current.formatProtocolFee('5')).toBeNull();
        expect(calls.some((url) => url.includes('vs_currencies=eur'))).toBe(true);
    });

    it('honors privacy fallback changes and releases every subscription on unmount', async () => {
        const calls = venue();
        const { result, rerender, unmount } = renderHook(
            (props) => useFeeFiat(props),
            { initialProps: options() },
        );

        await waitFor(() => expect(result.current.formatNativeFee('0.00001')).toBe('≈ $1.00 USD'));

        rerender(options({
            settings: { fiatCurrency: 'EUR', privacy: { priceDataEnabled: false } },
        }));
        await waitFor(() => expect(result.current.formatNativeFee('0.00001')).toBeNull());
        expect(calls.some((url) => url.includes('api.coingecko.com'))).toBe(false);

        expect(unsubscribeSpies).toHaveLength(3);
        expect(unsubscribeSpies.every((unsubscribe) => unsubscribe.mock.calls.length === 0)).toBe(true);
        unmount();
        expect(unsubscribeSpies.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
    });
});
