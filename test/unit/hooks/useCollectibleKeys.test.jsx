// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { fetchTokenInfo, messaging } = vi.hoisted(() => ({
    fetchTokenInfo: vi.fn(),
    messaging: { name: 'test-messaging' },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useTokenInfo.js', () => ({
    fetchTokenInfo,
}));

const { useCollectibleKeys } = await import(
    '../../../packages/core/src/shared/hooks/useCollectibleKeys.js');

function tokenRow(tick, overrides = {}) {
    return {
        kind: 'token', chainId: 'bitcoin-regtest', tick, divisibility: 0, ...overrides,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

beforeEach(() => { fetchTokenInfo.mockReset(); });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useCollectibleKeys', () => {
    it('returns an empty Set for a non-array input', () => {
        const { result } = renderHook(() => useCollectibleKeys({ rows: [] }));

        expect(result.current).toBeInstanceOf(Set);
        expect(result.current.size).toBe(0);
        expect(fetchTokenInfo).not.toHaveBeenCalled();
    });

    it('does not look up native or nonzero-divisibility rows', () => {
        const rows = [
            tokenRow('BTC', { kind: 'native' }),
            tokenRow('COIN', { divisibility: 8 }),
        ];
        const { result } = renderHook(() => useCollectibleKeys(rows));

        expect(result.current.size).toBe(0);
        expect(fetchTokenInfo).not.toHaveBeenCalled();
    });

    it('includes only zero-divisibility rows with a locked maximum supply', async () => {
        const infoByKey = {
            'bitcoin-regtest:ART': { locks: { max_supply: true } },
            'bitcoin-regtest:OPEN': { locks: {} },
        };
        fetchTokenInfo.mockImplementation((_, chainId, tick) => (
            Promise.resolve(infoByKey[`${chainId}:${tick}`])
        ));
        const { result } = renderHook(() => useCollectibleKeys([
            tokenRow('ART'), tokenRow('OPEN'),
        ]));

        await waitFor(() => expect(result.current).toEqual(new Set(['bitcoin-regtest:ART'])));
        expect(fetchTokenInfo).toHaveBeenCalledTimes(2);
    });
});

describe('useCollectibleKeys request lifecycle', () => {
    it('fetches each key once across equal row-list re-renders', async () => {
        fetchTokenInfo.mockResolvedValue({ locks: { max_supply: true } });
        const equalRows = () => [tokenRow('ART'), tokenRow('PHOTO')];
        const { rerender } = renderHook(
            ({ rows }) => useCollectibleKeys(rows),
            { initialProps: { rows: equalRows() } },
        );
        await waitFor(() => expect(fetchTokenInfo).toHaveBeenCalledTimes(2));

        rerender({ rows: equalRows() });
        await act(async () => { await Promise.resolve(); });

        expect(fetchTokenInfo).toHaveBeenCalledTimes(2);
        expect(fetchTokenInfo.mock.calls.map(([, chainId, tick]) => `${chainId}:${tick}`))
            .toEqual(['bitcoin-regtest:ART', 'bitcoin-regtest:PHOTO']);
    });

    it('ignores a lookup that resolves after unmount', async () => {
        const lookup = deferred();
        const info = { locks: { max_supply: true } };
        fetchTokenInfo.mockReturnValue(lookup.promise);
        const cacheSet = vi.spyOn(Map.prototype, 'set');

        try {
            const { unmount } = renderHook(() => useCollectibleKeys([tokenRow('LATE')]));
            expect(fetchTokenInfo).toHaveBeenCalledWith(messaging, 'bitcoin-regtest', 'LATE');
            unmount();
            cacheSet.mockClear();

            await act(async () => { lookup.resolve(info); await lookup.promise; });

            expect(cacheSet).not.toHaveBeenCalledWith('bitcoin-regtest:LATE', info);
        } finally {
            cacheSet.mockRestore();
        }
    });
});
