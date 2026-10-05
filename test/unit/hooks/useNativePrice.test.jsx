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
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { messaging } = vi.hoisted(() => ({ messaging: {} }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

const { useNativePrice } = await import(
    '../../../packages/core/src/shared/hooks/useNativePrice.js'
);

const CHAIN_ID = 'dogecoin-mainnet';
const ENTRY = {
    priceFiat: 0.24,
    marketCapFiat: 36_000_000_000,
    change24hPct: 1.5,
    sparkline: [0.23, 0.24],
    fetchedAt: 1_780_000_000_000,
};

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

beforeEach(() => {
    messaging.getNativePricesRequest = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete messaging.getNativePricesRequest;
});

describe('useNativePrice inactive states', () => {
    it('stays idle when no chain is selected', () => {
        const { result } = renderHook(() => useNativePrice(null));

        expect(result.current).toEqual({
            entry: null,
            loading: false,
            disabled: false,
            error: null,
        });
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });

    it('is disabled when messaging does not expose the request', () => {
        delete messaging.getNativePricesRequest;

        const { result } = renderHook(() => useNativePrice(CHAIN_ID));

        expect(result.current.disabled).toBe(true);
        expect(result.current.entry).toBe(null);
        expect(result.current.loading).toBe(false);
    });

    it('uses a disabled response without an entry', async () => {
        messaging.getNativePricesRequest.mockResolvedValue({ disabled: true });
        const { result } = renderHook(() => useNativePrice(CHAIN_ID));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.disabled).toBe(true);
        expect(result.current.entry).toBe(null);
        expect(result.current.error).toBe(null);
    });
});

describe('useNativePrice successful responses', () => {
    it('returns the chain entry and omits sparkline data by default', async () => {
        messaging.getNativePricesRequest.mockResolvedValue({ prices: { [CHAIN_ID]: ENTRY } });
        const { result } = renderHook(() => useNativePrice(CHAIN_ID));

        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.entry).toBe(ENTRY);
        expect(result.current.disabled).toBe(false);
        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: [CHAIN_ID],
            includeSparkline: false,
        });
    });

    it('requests sparkline data when the option is truthy', async () => {
        messaging.getNativePricesRequest.mockResolvedValue({ prices: {} });
        const { result } = renderHook(() => useNativePrice(CHAIN_ID, { includeSparkline: 'yes' }));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: [CHAIN_ID],
            includeSparkline: true,
        });
    });

    it('surfaces an error returned in a resolved response', async () => {
        messaging.getNativePricesRequest.mockResolvedValue({ error: 'Oracle unavailable' });
        const { result } = renderHook(() => useNativePrice(CHAIN_ID));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('Oracle unavailable');
        expect(result.current.entry).toBe(null);
    });
});

describe('useNativePrice rejected and late responses', () => {
    it.each([
        [new Error('Request failed'), 'Request failed'],
        [{}, 'Price fetch failed'],
    ])('surfaces a rejected request as %s', async (rejection, expected) => {
        messaging.getNativePricesRequest.mockRejectedValue(rejection);
        const { result } = renderHook(() => useNativePrice(CHAIN_ID));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe(expected);
        expect(result.current.entry).toBe(null);
    });

    it('ignores a response that lands after unmount', async () => {
        const pending = deferred();
        messaging.getNativePricesRequest.mockReturnValue(pending.promise);
        const { result, unmount } = renderHook(() => useNativePrice(CHAIN_ID));
        const mountedState = result.current;

        expect(mountedState.loading).toBe(true);
        unmount();
        await act(async () => {
            pending.resolve({ prices: { [CHAIN_ID]: ENTRY } });
            await pending.promise;
        });

        expect(result.current).toBe(mountedState);
        expect(result.current.entry).toBe(null);
        expect(result.current.loading).toBe(true);
    });
});
