// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferNonCriticalWork } from '../../../packages/web/src/deferNonCriticalWork.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('deferNonCriticalWork edge paths', () => {
    it('uses and cancels an idle callback when the browser provides one', () => {
        const work = vi.fn();
        const requestIdleCallback = vi.fn(() => 41);
        const cancelIdleCallback = vi.fn();
        vi.stubGlobal('requestIdleCallback', requestIdleCallback);
        vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

        const cancel = deferNonCriticalWork(work);

        expect(requestIdleCallback).toHaveBeenCalledWith(work, { timeout: 1000 });
        cancel();
        expect(cancelIdleCallback).toHaveBeenCalledWith(41);
    });

    it('tolerates an idle scheduler without a cancellation API', () => {
        vi.stubGlobal('requestIdleCallback', vi.fn(() => 17));
        vi.stubGlobal('cancelIdleCallback', undefined);

        expect(() => deferNonCriticalWork(() => {})()).not.toThrow();
    });

    it('falls back to a short timer and permits cancellation', () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestIdleCallback', undefined);
        const first = vi.fn();
        const second = vi.fn();

        deferNonCriticalWork(first);
        const cancel = deferNonCriticalWork(second);
        cancel();
        vi.advanceTimersByTime(15);
        expect(first).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });
});
