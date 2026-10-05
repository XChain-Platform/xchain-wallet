// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useBalancesHidden } from '../../../packages/core/src/shared/hooks/useBalancesHidden.js';

const STORAGE_KEY = 'xc:balancesHidden';
const CHANGE_EVENT = 'xc:balances-hidden-change';

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe('useBalancesHidden', () => {
    it('starts visible with a toggle when no preference is stored', () => {
        const { result } = renderHook(() => useBalancesHidden());

        expect(result.current[0]).toBe(false);
        expect(result.current[1]).toEqual(expect.any(Function));
    });

    it('starts hidden on its first render when the stored preference is one', () => {
        window.localStorage.setItem(STORAGE_KEY, '1');
        const initialValues = [];

        renderHook(() => {
            const value = useBalancesHidden();
            initialValues.push(value[0]);
            return value;
        });

        expect(initialValues[0]).toBe(true);
    });

    it('persists and broadcasts both toggle directions to another instance', async () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const dispatch = vi.spyOn(window, 'dispatchEvent');
        const first = renderHook(() => useBalancesHidden());
        const second = renderHook(() => useBalancesHidden());

        await act(async () => {
            first.result.current[1]();
            await Promise.resolve();
        });
        expect(first.result.current[0]).toBe(true);
        expect(second.result.current[0]).toBe(true);
        expect(setItem).toHaveBeenLastCalledWith(STORAGE_KEY, '1');

        await act(async () => {
            first.result.current[1]();
            await Promise.resolve();
        });
        const changes = dispatch.mock.calls
            .map(([event]) => event)
            .filter((event) => event.type === CHANGE_EVENT);
        expect(first.result.current[0]).toBe(false);
        expect(second.result.current[0]).toBe(false);
        expect(setItem).toHaveBeenLastCalledWith(STORAGE_KEY, '0');
        expect(changes.map((event) => event.detail)).toEqual([true, false]);
        expect(changes.every((event) => event instanceof CustomEvent)).toBe(true);
    });

    it('follows matching storage events and ignores other keys', () => {
        const { result } = renderHook(() => useBalancesHidden());

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '1' }));
        });
        expect(result.current[0]).toBe(false);

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: '1' }));
        });
        expect(result.current[0]).toBe(true);
    });

    it('removes both window listeners on unmount', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useBalancesHidden());
        const changeListener = add.mock.calls.find(([type]) => type === CHANGE_EVENT)?.[1];
        const storageListener = add.mock.calls.find(([type]) => type === 'storage')?.[1];

        expect(changeListener).toEqual(expect.any(Function));
        expect(storageListener).toEqual(expect.any(Function));
        unmount();

        expect(remove).toHaveBeenCalledWith(CHANGE_EVENT, changeListener);
        expect(remove).toHaveBeenCalledWith('storage', storageListener);
    });

    it('starts visible when reading local storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        const { result } = renderHook(() => useBalancesHidden());

        expect(result.current[0]).toBe(false);
    });
});
