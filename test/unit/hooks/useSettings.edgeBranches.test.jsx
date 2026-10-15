// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { messagingState } = vi.hoisted(() => ({
    messagingState: { current: {} },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingState.current }),
}));

vi.mock('../../../packages/core/src/registry/index.js', () => ({
    defaultRegistry: vi.fn(() => ({})),
    hydrateCustomChainsFromSettings: vi.fn(),
}));

const { useSettings } = await import(
    '../../../packages/core/src/shared/hooks/useSettings.js'
);

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
    messagingState.current = {};
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useSettings edge branches', () => {
    it('reports missing read and update routes without throwing during render', async () => {
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error?.message).toContain('getSettings is not available');
        await expect(result.current.update({ developerMode: true }))
            .rejects.toThrow('updateSettings is not available');
    });

    it('normalizes a non-Error read rejection', async () => {
        messagingState.current = {
            getSettings: vi.fn(() => Promise.reject('vault locked')),
        };
        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toEqual(new Error('vault locked'));
    });

    it('ignores a stale rejected read', async () => {
        const first = deferred();
        const getSettings = vi.fn()
            .mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce({ walletMode: 'watcher', fiatCurrency: 'USD' });
        messagingState.current = { getSettings };
        const { result } = renderHook(() => useSettings());

        act(() => window.dispatchEvent(new Event('xc:session-changed')));
        await waitFor(() => expect(result.current.settings).toEqual({ walletMode: 'watcher', fiatCurrency: 'USD' }));
        await act(async () => {
            first.reject(new Error('stale failure'));
            await first.promise.catch(() => undefined);
        });

        expect(result.current.error).toBeNull();
    });

    it('accepts an update when event construction is unavailable', async () => {
        const next = { developerMode: true, fiatCurrency: 'USD' };
        messagingState.current = {
            getSettings: vi.fn(async () => ({ developerMode: false })),
            updateSettings: vi.fn(async () => next),
        };
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => window.dispatchEvent(new CustomEvent('xc:settings-changed')));
        vi.stubGlobal('CustomEvent', class UnsupportedCustomEvent {
            constructor() { throw new Error('CustomEvent unavailable'); }
        });

        await act(async () => expect(result.current.update({ developerMode: true })).resolves.toBe(next));

        expect(result.current.settings).toBe(next);
        expect(result.current.error).toBeNull();
    });

    it('does not refresh or update state after unmount', async () => {
        const pendingUpdate = deferred();
        const getSettings = vi.fn(async () => ({ developerMode: false }));
        messagingState.current = {
            getSettings,
            updateSettings: vi.fn(() => pendingUpdate.promise),
        };
        const addListener = vi.spyOn(window, 'addEventListener');
        const { result, unmount } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const refresh = result.current.refresh;
        const update = result.current.update({ developerMode: true });
        const changed = addListener.mock.calls.find(([name]) => name === 'xc:settings-changed')?.[1];
        const session = addListener.mock.calls.find(([name]) => name === 'xc:session-changed')?.[1];

        unmount();
        changed?.({ detail: { developerMode: true } });
        session?.();
        await refresh();
        expect(getSettings).toHaveBeenCalledTimes(1);

        vi.stubGlobal('window', undefined);
        pendingUpdate.resolve({ developerMode: true, fiatCurrency: 'USD' });
        await expect(update).resolves.toEqual({ developerMode: true, fiatCurrency: 'USD' });
    });
});
