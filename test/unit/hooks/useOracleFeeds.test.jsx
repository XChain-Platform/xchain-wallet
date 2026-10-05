// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOracleFeeds } from '../../../packages/core/src/shared/hooks/useOracleFeeds.js';
import { isOraclePricedRow } from '../../../packages/core/src/shared/utils/dispenserPricing.js';

function oracleRow(overrides = {}) {
    return {
        get_coin: 'DOGE',
        get_amount: '0',
        oracle_address: 'oracle-a',
        give_tick: 'XCP',
        ...overrides,
    };
}

function deferred() {
    let resolve = () => {};
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('useOracleFeeds lookup eligibility', () => {
    it('ignores rows rejected by the oracle pricing predicate', () => {
        const row = oracleRow({ get_amount: '1' });
        const messaging = { oracleFeeds: vi.fn() };
        expect(isOraclePricedRow(row)).toBe(false);

        const { result } = renderHook(() => useOracleFeeds(messaging, [{ chainId: 'dogecoin', row }]));

        expect(result.current('dogecoin', row)).toBe(undefined);
        expect(messaging.oracleFeeds).not.toHaveBeenCalled();
    });

    it('returns null when the host cannot read feeds', () => {
        const row = oracleRow();
        expect(isOraclePricedRow(row)).toBe(true);

        const { result } = renderHook(() => useOracleFeeds({}, [{ chainId: 'dogecoin', row }]));

        expect(result.current('dogecoin', row)).toBe(null);
    });
});

describe('useOracleFeeds request results', () => {
    it('deduplicates a chain and oracle pair and shares its result', async () => {
        const feeds = [{ tick: 'XCP', fiat: 'USD', live: { value: '2' } }];
        const messaging = { oracleFeeds: vi.fn(async () => feeds) };
        const first = oracleRow({ give_amount: '1' });
        const second = oracleRow({ give_amount: '2' });
        const entries = [first, second].map((row) => ({ chainId: 'dogecoin', row }));
        const { result } = renderHook(() => useOracleFeeds(messaging, entries));

        await waitFor(() => expect(result.current('dogecoin', first)).toBe(feeds));

        expect(messaging.oracleFeeds).toHaveBeenCalledTimes(1);
        expect(messaging.oracleFeeds).toHaveBeenCalledWith({ chainId: 'dogecoin', address: 'oracle-a' });
        expect(result.current('dogecoin', second)).toBe(feeds);
    });

    it('normalizes invalid and rejected results to empty arrays', async () => {
        const invalid = oracleRow({ oracle_address: 'invalid' });
        const rejected = oracleRow({ oracle_address: 'rejected' });
        const messaging = {
            oracleFeeds: vi.fn(({ address }) => address === 'invalid'
                ? Promise.resolve({ feeds: [] })
                : Promise.reject(new Error('unavailable'))),
        };
        const entries = [invalid, rejected].map((row) => ({ chainId: 'dogecoin', row }));
        const { result } = renderHook(() => useOracleFeeds(messaging, entries));

        await waitFor(() => expect(result.current('dogecoin', invalid)).toEqual([]));
        await waitFor(() => expect(result.current('dogecoin', rejected)).toEqual([]));
    });
});

describe('useOracleFeeds lifecycle', () => {
    it('returns undefined while a read is pending', async () => {
        const pending = deferred();
        const row = oracleRow();
        const messaging = { oracleFeeds: vi.fn(() => pending.promise) };
        const { result } = renderHook(() => useOracleFeeds(messaging, [{ chainId: 'dogecoin', row }]));

        await waitFor(() => expect(messaging.oracleFeeds).toHaveBeenCalledTimes(1));
        expect(result.current('dogecoin', row)).toBe(undefined);
    });

    it('allows an in-flight read to resolve after unmount', async () => {
        const pending = deferred();
        const row = oracleRow();
        const messaging = { oracleFeeds: vi.fn(() => pending.promise) };
        const { unmount } = renderHook(() => useOracleFeeds(messaging, [{ chainId: 'dogecoin', row }]));
        await waitFor(() => expect(messaging.oracleFeeds).toHaveBeenCalledTimes(1));

        unmount();

        await expect(act(async () => {
            pending.resolve([{ tick: 'XCP' }]);
            await pending.promise;
        })).resolves.toBe(undefined);
    });
});
