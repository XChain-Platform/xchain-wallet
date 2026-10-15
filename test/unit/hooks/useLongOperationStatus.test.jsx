// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongOperationStatus } from '../../../packages/core/src/shared/hooks/useLongOperationStatus.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useLongOperationStatus', () => {
    it('reveals elapsed time and reports the advisory timeout at their thresholds', () => {
        const { result } = renderHook(() => useLongOperationStatus(true, {
            revealAfterMs: 2_000,
            timeoutMs: 3_000,
        }));

        expect(result.current).toEqual({
            elapsedSeconds: 0, showElapsed: false, timedOut: false,
        });
        act(() => vi.advanceTimersByTime(1_000));
        expect(result.current).toEqual({
            elapsedSeconds: 1, showElapsed: false, timedOut: false,
        });
        act(() => vi.advanceTimersByTime(1_000));
        expect(result.current).toEqual({
            elapsedSeconds: 2, showElapsed: true, timedOut: false,
        });
        act(() => vi.advanceTimersByTime(1_000));
        expect(result.current).toEqual({
            elapsedSeconds: 3, showElapsed: true, timedOut: true,
        });
    });

    it('resets when inactive and clears the running interval', () => {
        const { result, rerender } = renderHook(
            ({ active }) => useLongOperationStatus(active),
            { initialProps: { active: true } },
        );

        act(() => vi.advanceTimersByTime(4_000));
        expect(result.current.elapsedSeconds).toBe(4);
        expect(vi.getTimerCount()).toBe(1);

        rerender({ active: false });
        expect(result.current).toEqual({
            elapsedSeconds: 0, showElapsed: false, timedOut: false,
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never exposes a negative elapsed time when the system clock moves backward', () => {
        const { result } = renderHook(() => useLongOperationStatus(true, {
            revealAfterMs: 0,
            timeoutMs: 1,
        }));

        vi.setSystemTime(new Date('2026-10-13T11:59:00Z'));
        act(() => vi.advanceTimersByTime(1_000));

        expect(result.current).toEqual({
            elapsedSeconds: 0, showElapsed: true, timedOut: false,
        });
    });
});
