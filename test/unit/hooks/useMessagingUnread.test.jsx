// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMessagingUnread } from '../../../packages/core/src/shared/hooks/useMessagingUnread.js';
import { writeMsgUnread } from '../../../packages/core/src/shared/utils/msgReadMemory.js';

beforeEach(() => { localStorage.clear(); });

afterEach(() => {
    cleanup();
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
});
