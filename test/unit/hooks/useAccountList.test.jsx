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
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAccountList } from '../../../packages/core/src/shared/hooks/useAccountList.js';

const mocked = vi.hoisted(() => ({ messaging: undefined }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocked.messaging }),
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    mocked.messaging = { listAccounts: vi.fn() };
});

afterEach(() => {
    mocked.messaging = undefined;
    vi.restoreAllMocks();
});

describe('useAccountList input handling', () => {
    it('returns an empty list without asking for accounts when walletId is absent', () => {
        const { result } = renderHook(() => useAccountList(undefined));

        expect(result.current).toEqual([]);
        expect(mocked.messaging.listAccounts).not.toHaveBeenCalled();
    });

    it('returns an empty list when the messaging bridge has no account route', () => {
        mocked.messaging = {};

        const { result } = renderHook(() => useAccountList('wallet-a'));

        expect(result.current).toEqual([]);
    });

    it('returns an empty list when the account route resolves to a non-array', async () => {
        const response = deferred();
        mocked.messaging.listAccounts.mockReturnValue(response.promise);
        const { result } = renderHook(() => useAccountList('wallet-a'));

        await act(() => response.resolve({ accounts: [] }));
        expect(mocked.messaging.listAccounts).toHaveBeenCalledWith('wallet-a');
        expect(result.current).toEqual([]);
    });

    it('returns an empty list when the account route rejects', async () => {
        const response = deferred();
        mocked.messaging.listAccounts.mockReturnValue(response.promise);
        const { result } = renderHook(() => useAccountList('wallet-a'));

        await act(() => response.reject(new Error('unavailable')));
        expect(mocked.messaging.listAccounts).toHaveBeenCalledWith('wallet-a');
        expect(result.current).toEqual([]);
    });
});

describe('useAccountList account ordering', () => {
    it('sorts by ascending index without mutating the resolved array', async () => {
        const accounts = [
            { id: 'third', index: 3 },
            { id: 'missing' },
            { id: 'second', index: 2 },
        ];
        const originalOrder = [...accounts];
        mocked.messaging.listAccounts.mockResolvedValue(accounts);

        const { result } = renderHook(() => useAccountList('wallet-a'));

        await waitFor(() => expect(result.current).toEqual([
            { id: 'missing' },
            { id: 'second', index: 2 },
            { id: 'third', index: 3 },
        ]));
        expect(accounts).toEqual(originalOrder);
        expect(result.current).not.toBe(accounts);
    });
});

describe('useAccountList wallet changes', () => {
    it('clears the previous wallet while the next wallet is loading', async () => {
        const next = deferred();
        mocked.messaging.listAccounts
            .mockResolvedValueOnce([{ id: 'old', index: 1 }])
            .mockReturnValueOnce(next.promise);
        const { result, rerender } = renderHook(
            ({ walletId }) => useAccountList(walletId),
            { initialProps: { walletId: 'wallet-a' } },
        );
        await waitFor(() => expect(result.current).toEqual([{ id: 'old', index: 1 }]));

        rerender({ walletId: 'wallet-b' });

        expect(result.current).toEqual([]);
        expect(mocked.messaging.listAccounts).toHaveBeenLastCalledWith('wallet-b');
        await act(() => next.resolve([{ id: 'new', index: 1 }]));
        expect(result.current).toEqual([{ id: 'new', index: 1 }]);
    });
});

describe('useAccountList cancellation', () => {
    it('ignores a resolution from a wallet that is no longer active', async () => {
        const first = deferred();
        const second = deferred();
        mocked.messaging.listAccounts
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const { result, rerender } = renderHook(
            ({ walletId }) => useAccountList(walletId),
            { initialProps: { walletId: 'wallet-a' } },
        );

        rerender({ walletId: 'wallet-b' });
        await act(() => first.resolve([{ id: 'stale', index: 1 }]));
        expect(result.current).toEqual([]);
        await act(() => second.resolve([{ id: 'current', index: 1 }]));
        expect(result.current).toEqual([{ id: 'current', index: 1 }]);
    });

    it('ignores a resolution after unmount', async () => {
        const pending = deferred();
        const renders = [];
        mocked.messaging.listAccounts.mockReturnValue(pending.promise);
        const { unmount } = renderHook(() => {
            const accounts = useAccountList('wallet-a');
            renders.push(accounts);
            return accounts;
        });

        const renderCountAtUnmount = renders.length;
        unmount();
        await act(() => pending.resolve([{ id: 'late', index: 1 }]));

        expect(renders).toHaveLength(renderCountAtUnmount);
    });
});
