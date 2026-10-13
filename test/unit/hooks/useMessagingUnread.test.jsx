// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMessagingUnread } from '../../../packages/core/src/shared/hooks/useMessagingUnread.js';
import {
    MSG_UNREAD_EVENT, writeMsgUnread,
} from '../../../packages/core/src/shared/utils/msgReadMemory.js';

beforeEach(() => { localStorage.clear(); });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('useMessagingUnread', () => {
    it('reads the stored count and follows same-document updates', () => {
        writeMsgUnread('wallet-1', 'account-1', 2);
        const { result } = renderHook(() => useMessagingUnread('wallet-1', 'account-1'));

        expect(result.current).toBe(2);

        act(() => writeMsgUnread('wallet-1', 'account-1', 5));
        expect(result.current).toBe(5);
    });

    it('switches account scope and ignores updates in another account', () => {
        writeMsgUnread('wallet-1', 'account-1', 1);
        writeMsgUnread('wallet-1', 'account-2', 4);
        const { result, rerender } = renderHook(
            ({ accountId }) => useMessagingUnread('wallet-1', accountId),
            { initialProps: { accountId: 'account-1' } },
        );

        rerender({ accountId: 'account-2' });
        expect(result.current).toBe(4);

        act(() => writeMsgUnread('wallet-1', 'account-1', 9));
        expect(result.current).toBe(4);
    });

    it('removes its window and document listeners on unmount', () => {
        const addWindow = vi.spyOn(window, 'addEventListener');
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        const addDocument = vi.spyOn(document, 'addEventListener');
        const removeDocument = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => useMessagingUnread('wallet-1', 'account-1'));
        const unreadListener = addWindow.mock.calls
            .find(([type]) => type === MSG_UNREAD_EVENT)?.[1];
        const storageListener = addWindow.mock.calls.find(([type]) => type === 'storage')?.[1];
        const visibilityListener = addDocument.mock.calls
            .find(([type]) => type === 'visibilitychange')?.[1];

        expect(unreadListener).toEqual(expect.any(Function));
        expect(storageListener).toEqual(expect.any(Function));
        expect(visibilityListener).toEqual(expect.any(Function));
        unmount();

        expect(removeWindow).toHaveBeenCalledWith(MSG_UNREAD_EVENT, unreadListener);
        expect(removeWindow).toHaveBeenCalledWith('storage', storageListener);
        expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityListener);
    });
});
