// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reactState, unreadState } = vi.hoisted(() => ({
    reactState: { cleanup: undefined, setCount: vi.fn() },
    unreadState: { count: 2, read: vi.fn() },
}));

vi.mock('react', () => ({
    useState(initialValue) {
        const value = typeof initialValue === 'function' ? initialValue() : initialValue;
        return [value, reactState.setCount];
    },
    useEffect(effect) {
        reactState.cleanup = effect();
    },
}));

vi.mock('../../../packages/core/src/shared/utils/msgReadMemory.js', () => ({
    MSG_UNREAD_EVENT: 'xc:test-unread',
    readMsgUnread: (...args) => unreadState.read(...args),
}));

const { useMessagingUnread } = await import(
    '../../../packages/core/src/shared/hooks/useMessagingUnread.js'
);

beforeEach(() => {
    reactState.cleanup = undefined;
    reactState.setCount.mockReset();
    unreadState.count = 2;
    unreadState.read.mockReset();
    unreadState.read.mockImplementation(() => unreadState.count);
});

afterEach(() => {
    reactState.cleanup?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useMessagingUnread edge branches', () => {
    it('refreshes on visibility changes only when the document is visible', () => {
        let visibility = 'hidden';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        expect(useMessagingUnread('wallet-1', 'account-1')).toBe(2);
        const readsAfterMount = unreadState.read.mock.calls.length;

        unreadState.count = 7;
        document.dispatchEvent(new Event('visibilitychange'));
        expect(unreadState.read).toHaveBeenCalledTimes(readsAfterMount);

        visibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        expect(unreadState.read).toHaveBeenCalledTimes(readsAfterMount + 1);
        expect(reactState.setCount).toHaveBeenLastCalledWith(7);
    });

    it('returns the snapshot without registering browser listeners on the server', () => {
        vi.stubGlobal('window', undefined);

        expect(useMessagingUnread('wallet-1', 'account-1')).toBe(2);
        expect(reactState.setCount).toHaveBeenCalledWith(2);
        expect(reactState.cleanup).toBeUndefined();
    });
});
