// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWatchAvailable } from '../../../packages/core/src/shared/hooks/useWatchAvailable.js';

function deferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useWatchAvailable', () => {
    it('starts false and reads true only after an exact true answer settles', async () => {
        const answer = deferred();
        const bridge = { isAvailable: vi.fn(() => answer.promise) };
        const { result } = renderHook(() => useWatchAvailable({ bridge }));

        expect(result.current).toBe(false);
        await waitFor(() => expect(bridge.isAvailable).toHaveBeenCalledTimes(1));

        await act(async () => answer.resolve(true));

        expect(result.current).toBe(true);
    });

    it.each([
        ['false', false],
        ['a truthy non-boolean', 'yes'],
    ])('stays false for %s', async (_label, value) => {
        const bridge = { isAvailable: vi.fn().mockResolvedValue(value) };
        const { result } = renderHook(() => useWatchAvailable({ bridge }));

        await waitFor(() => expect(bridge.isAvailable).toHaveBeenCalledTimes(1));

        expect(result.current).toBe(false);
    });

    it.each([
        ['a rejected probe', () => Promise.reject(new Error('unavailable'))],
        ['a synchronously throwing probe', () => { throw new Error('unavailable'); }],
    ])('stays false without throwing for %s', async (_label, isAvailable) => {
        const bridge = { isAvailable: vi.fn(isAvailable) };
        const { result } = renderHook(() => useWatchAvailable({ bridge }));

        await waitFor(() => expect(bridge.isAvailable).toHaveBeenCalledTimes(1));

        expect(result.current).toBe(false);
    });

    it('does not update state after unmount', async () => {
        const answer = deferred();
        const bridge = { isAvailable: vi.fn(() => answer.promise) };
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { unmount } = renderHook(() => useWatchAvailable({ bridge }));

        unmount();
        await act(async () => answer.resolve(true));

        expect(consoleError).not.toHaveBeenCalled();
    });

    it('probes only once when rerendered with the same bridge', async () => {
        const bridge = { isAvailable: vi.fn().mockResolvedValue(true) };
        const { result, rerender } = renderHook(
            ({ currentBridge }) => useWatchAvailable({ bridge: currentBridge }),
            { initialProps: { currentBridge: bridge } },
        );

        await waitFor(() => expect(result.current).toBe(true));
        rerender({ currentBridge: bridge });

        expect(bridge.isAvailable).toHaveBeenCalledTimes(1);
        expect(result.current).toBe(true);
    });

    it('probes a new bridge and ignores a late answer from the old bridge', async () => {
        const oldAnswer = deferred();
        const oldBridge = { isAvailable: vi.fn(() => oldAnswer.promise) };
        const newBridge = { isAvailable: vi.fn().mockResolvedValue(false) };
        const { result, rerender } = renderHook(
            ({ bridge }) => useWatchAvailable({ bridge }),
            { initialProps: { bridge: oldBridge } },
        );

        rerender({ bridge: newBridge });
        expect(result.current).toBe(false);
        await waitFor(() => expect(newBridge.isAvailable).toHaveBeenCalledTimes(1));

        await act(async () => oldAnswer.resolve(true));

        expect(oldBridge.isAvailable).toHaveBeenCalledTimes(1);
        expect(result.current).toBe(false);
    });

    it('uses the default bridge and reads false without a Capacitor global', async () => {
        const originalCapacitor = Object.getOwnPropertyDescriptor(globalThis, 'Capacitor');
        delete globalThis.Capacitor;

        try {
            const { result } = renderHook(() => useWatchAvailable());

            expect(result.current).toBe(false);
            await act(async () => Promise.resolve());
            expect(result.current).toBe(false);
        } finally {
            if (originalCapacitor) {
                Object.defineProperty(globalThis, 'Capacitor', originalCapacitor);
            } else {
                delete globalThis.Capacitor;
            }
        }
    });
});
