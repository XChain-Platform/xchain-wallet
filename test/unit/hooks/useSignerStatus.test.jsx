// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSignerStatus } from '../../../packages/core/src/shared/hooks/useSignerStatus.js';

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useSignerStatus', () => {
    it('polls immediately and uses the steady cadence after availability', async () => {
        const getStatus = vi.fn(async () => ({ status: 'available', detail: 'ready' }));
        const { result } = renderHook(() => useSignerStatus({
            getStatus, chainId: 'bitcoin-regtest',
        }));

        await act(async () => { await Promise.resolve(); });
        expect(result.current).toMatchObject({ status: 'available', detail: 'ready' });
        expect(getStatus).toHaveBeenCalledWith({ chainId: 'bitcoin-regtest' });

        await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
        expect(getStatus).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('uses the fast cadence after a disconnected response', async () => {
        const getStatus = vi.fn(async () => ({ status: 'disconnected' }));
        const { result } = renderHook(() => useSignerStatus({ getStatus }));
        await act(async () => { await Promise.resolve(); });
        expect(result.current.status).toBe('disconnected');

        await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
        expect(getStatus).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('maps polling failures and supports manual refresh', async () => {
        const getStatus = vi.fn().mockRejectedValue(new Error('device missing'));
        const { result } = renderHook(() => useSignerStatus({ getStatus }));
        await act(async () => { await Promise.resolve(); });

        expect(result.current).toMatchObject({
            status: 'disconnected', detail: 'device missing',
        });

        await act(async () => {
            result.current.refresh();
            await Promise.resolve();
        });
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('stays idle and does not schedule work without a status reader', async () => {
        const { result } = renderHook(() => useSignerStatus({ getStatus: null }));

        await act(async () => { await vi.runAllTimersAsync(); });
        expect(result.current).toEqual({
            status: 'idle', detail: null, refresh: expect.any(Function),
        });
        expect(vi.getTimerCount()).toBe(0);
    });
});
