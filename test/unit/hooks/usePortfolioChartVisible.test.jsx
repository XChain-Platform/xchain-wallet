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
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePortfolioChartVisible } from '../../../packages/core/src/shared/hooks/usePortfolioChartVisible.js';

const STORAGE_KEY = 'xc:portfolioChartVisible';
const CHANGE_EVENT = 'xc:portfolio-chart-visible-change';

beforeEach(() => window.localStorage.clear());

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('usePortfolioChartVisible initialization', () => {
    it('defaults to visible when no preference is stored', () => {
        const { result } = renderHook(() => usePortfolioChartVisible());
        expect(result.current[0]).toBe(true);
    });

    it('defaults to visible when localStorage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        const { result } = renderHook(() => usePortfolioChartVisible());
        expect(result.current[0]).toBe(true);
    });

    it.each([['0', false], ['1', true]])('reads %s as %s', (stored, expected) => {
        window.localStorage.setItem(STORAGE_KEY, stored);
        const { result } = renderHook(() => usePortfolioChartVisible());
        expect(result.current[0]).toBe(expected);
    });
});

describe('usePortfolioChartVisible synchronization', () => {
    it('toggles, persists, broadcasts, and updates a second instance', async () => {
        const dispatch = vi.spyOn(window, 'dispatchEvent');
        const first = renderHook(() => usePortfolioChartVisible());
        const second = renderHook(() => usePortfolioChartVisible());

        await act(async () => {
            first.result.current[1]();
            await Promise.resolve();
        });
        expect(first.result.current[0]).toBe(false);
        expect(second.result.current[0]).toBe(false);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');
        expect(dispatch.mock.calls.some(([event]) => event.type === CHANGE_EVENT)).toBe(true);

        await act(async () => {
            second.result.current[1]();
            await Promise.resolve();
        });
        expect(first.result.current[0]).toBe(true);
        expect(second.result.current[0]).toBe(true);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
    });

    it('treats storage value 0 as false and every other value as true', () => {
        const { result } = renderHook(() => usePortfolioChartVisible());
        act(() => window.dispatchEvent(new StorageEvent('storage', {
            key: STORAGE_KEY, newValue: '0',
        })));
        expect(result.current[0]).toBe(false);

        act(() => window.dispatchEvent(new StorageEvent('storage', {
            key: STORAGE_KEY, newValue: null,
        })));
        expect(result.current[0]).toBe(true);
    });

    it('ignores storage events for other keys', () => {
        window.localStorage.setItem(STORAGE_KEY, '0');
        const { result } = renderHook(() => usePortfolioChartVisible());
        act(() => window.dispatchEvent(new StorageEvent('storage', {
            key: 'xc:another-setting', newValue: '1',
        })));
        expect(result.current[0]).toBe(false);
    });

    it('removes both event listeners on unmount', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => usePortfolioChartVisible());
        const customListener = add.mock.calls.find(([type]) => type === CHANGE_EVENT)?.[1];
        const storageListener = add.mock.calls.find(([type]) => type === 'storage')?.[1];

        unmount();

        expect(customListener).toEqual(expect.any(Function));
        expect(storageListener).toEqual(expect.any(Function));
        expect(remove).toHaveBeenCalledWith(CHANGE_EVENT, customListener);
        expect(remove).toHaveBeenCalledWith('storage', storageListener);
    });
});
