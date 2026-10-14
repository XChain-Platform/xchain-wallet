// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
    isNavigatorOnline,
    useOnlineStatus,
} from '../../../packages/core/src/shared/hooks/useOnlineStatus.js';

const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');

function setOnline(value) {
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value,
    });
}

beforeEach(() => {
    setOnline(true);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalOnline) {
        Object.defineProperty(navigator, 'onLine', originalOnline);
    } else {
        delete navigator.onLine;
    }
});

describe('useOnlineStatus', () => {
    it('reads the initial navigator state and follows connectivity events', () => {
        setOnline(false);
        const { result } = renderHook(() => useOnlineStatus());

        expect(result.current).toBe(false);

        setOnline(true);
        act(() => window.dispatchEvent(new Event('online')));
        expect(result.current).toBe(true);

        setOnline(false);
        act(() => window.dispatchEvent(new Event('offline')));
        expect(result.current).toBe(false);
    });

    it('treats only an explicit false navigator value as offline', () => {
        setOnline(undefined);
        expect(isNavigatorOnline()).toBe(true);

        setOnline(false);
        expect(isNavigatorOnline()).toBe(false);
    });

    it('removes both connectivity listeners on unmount', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useOnlineStatus());
        const onlineListener = add.mock.calls.find(([type]) => type === 'online')?.[1];
        const offlineListener = add.mock.calls.find(([type]) => type === 'offline')?.[1];

        expect(onlineListener).toEqual(expect.any(Function));
        expect(offlineListener).toEqual(expect.any(Function));

        unmount();

        expect(remove).toHaveBeenCalledWith('online', onlineListener);
        expect(remove).toHaveBeenCalledWith('offline', offlineListener);
    });
});
