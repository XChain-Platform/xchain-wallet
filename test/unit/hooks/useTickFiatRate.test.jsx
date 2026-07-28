// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// . `useTickFiatRate` is what an AmountField consumer should call:
// it prices the tick the field is holding rather than the chain coin.
// The bug it closes was a token amount rendered at the coin's rate
// (50,000 XCHAIN shown as billions of dollars), so the tests care about
// two things: the right rate reaches the right tick, and a tick nothing
// can price yields null rather than a neighbouring tick's number.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTickFiatRate } from '../../../packages/core/src/shared/hooks/useFiatRate.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

const NOW = Date.parse('2026-07-27T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const EXPLORER = { bitcoin: 'https://explorer.test' };

const SNAPSHOTS = [
    { coin_pair: 'BTC/USD', price: '100000', block_timestamp: FRESH_TS, status: 'FINALIZED' },
    { coin_pair: 'XCHAIN/USD', price: '0.42', block_timestamp: FRESH_TS, status: 'FINALIZED' },
];

const MARKETS = {
    // 0.0000002 BTC per PEPECASH x $100,000/BTC = $0.02
    'PEPECASH/BTC': {
        tick1: 'PEPECASH', tick2: 'BTC', tick1_price: '0.00000020', tick2_price: '5000000', last_updated: FRESH_TS,
    },
};

function venue() {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        if (url.includes('/api/price_snapshots/')) {
            return { ok: true, json: async () => ({ data: SNAPSHOTS }) };
        }
        const m = /\/api\/market\/([^/?]+)\/([^/?]+)/.exec(url);
        if (m) {
            const row = MARKETS[`${m[1]}/${m[2]}`];
            return { ok: true, json: async () => ({ data: row ? [row] : [] }) };
        }
        throw new Error(`unexpected url ${url}`);
    };
    configureFiatRateSource({ now: () => NOW, fetch: fetchImpl, explorerUrlByCoin: EXPLORER });
    return calls;
}

const args = (tick, nativeTicker = 'BTC') => ({ chainCoin: 'bitcoin', tick, nativeTicker });

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('useTickFiatRate', () => {
    it('prices the native coin from the coin feed', async () => {
        venue();
        const { result } = renderHook(() => useTickFiatRate(args('BTC')));

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current).toMatchObject({ rate: 100000, chainCoin: 'bitcoin', source: 'oracle' });
        expect(result.current.tick).toBeUndefined();
    });

    it('treats a blank tick as the native coin, the way every form does', async () => {
        venue();
        const { result } = renderHook(() => useTickFiatRate(args('')));

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current.rate).toBe(100000);
    });

    it('prices a token from its own oracle pair, not the coin rate', async () => {
        venue();
        const { result } = renderHook(() => useTickFiatRate(args('XCHAIN')));

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current).toMatchObject({ rate: 0.42, tick: 'XCHAIN', source: 'oracle' });
    });

    it('prices a DEX-traded token through its market against the coin', async () => {
        venue();
        const { result } = renderHook(() => useTickFiatRate(args('PEPECASH')));

        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current).toMatchObject({ rate: 0.02, tick: 'PEPECASH', source: 'market' });
    });

    it('returns null for a token nothing can price, never the coin rate', async () => {
        venue();
        const { result } = renderHook(() => useTickFiatRate(args('NOSUCHTOKEN')));

        // The coin rate lands first and is the wrong answer here, so give the
        // hook every chance to hand it over before asserting it did not.
        await waitFor(() => expect(result.current).toBeNull());
        await new Promise((r) => setTimeout(r, 10));
        expect(result.current).toBeNull();
    });

    it('fails closed while the chain descriptor has not resolved a native ticker', async () => {
        const calls = venue();
        const { result } = renderHook(() => useTickFiatRate(args('XCHAIN', '')));

        await new Promise((r) => setTimeout(r, 10));
        expect(result.current).toBeNull();
        // An unclassifiable tick must not be turned into a market lookup.
        expect(calls.some((url) => url.includes('/api/market/'))).toBe(false);
    });

    it('re-prices when the field switches tick', async () => {
        venue();
        const { result, rerender } = renderHook((props) => useTickFiatRate(props), {
            initialProps: args('BTC'),
        });
        await waitFor(() => expect(result.current?.rate).toBe(100000));

        rerender(args('XCHAIN'));
        await waitFor(() => expect(result.current?.rate).toBe(0.42));

        rerender(args('NOSUCHTOKEN'));
        await waitFor(() => expect(result.current).toBeNull());

        rerender(args('BTC'));
        await waitFor(() => expect(result.current?.rate).toBe(100000));
    });

    it('holds off entirely until a chain is known', async () => {
        const calls = venue();
        const { result } = renderHook(() => useTickFiatRate({ chainCoin: null, tick: 'XCHAIN', nativeTicker: 'BTC' }));

        await new Promise((r) => setTimeout(r, 10));
        expect(result.current).toBeNull();
        expect(calls).toEqual([]);
    });
});
