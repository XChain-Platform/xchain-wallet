// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUndoSend } from '../../../packages/core/src/shared/hooks/useUndoSend.js';

function setup(extra = {}) {
    const clock = { t: 10_000 };
    const ticks = { fn: null, ms: null, armed: 0, cleared: 0 };
    const onElapsed = vi.fn();
    const onCancelHold = vi.fn();
    const props = {
        onElapsed,
        onCancelHold,
        now: () => clock.t,
        setTick: (fn, ms) => {
            ticks.fn = fn;
            ticks.ms = ms;
            ticks.armed += 1;
            return 7;
        },
        clearTick: () => {
            ticks.cleared += 1;
            ticks.fn = null;
        },
        ...extra,
    };
    const view = renderHook((p) => useUndoSend(p), { initialProps: props });
    const advance = (ms) => {
        clock.t += ms;
        act(() => {
            ticks.fn?.();
        });
    };
    return { ...view, props, onElapsed, onCancelHold, ticks, advance };
}

describe('useUndoSend', () => {
    it('starts idle with nothing remaining', () => {
        const h = setup();
        expect(h.result.current.status).toBe('idle');
        expect(h.result.current.remaining).toBe(0);
    });

    it('start(5) reads counting and 5, then ticks down', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        expect(h.result.current.status).toBe('counting');
        expect(h.result.current.remaining).toBe(5);
        expect(h.ticks.ms).toBe(1000);

        h.advance(1000);
        expect(h.result.current.remaining).toBe(4);
        expect(h.result.current.status).toBe('counting');
    });

    it('elapses at 5000 ms, calls onElapsed once and clears the tick', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        h.advance(5000);
        expect(h.result.current.status).toBe('elapsed');
        expect(h.result.current.remaining).toBe(0);
        expect(h.onElapsed).toHaveBeenCalledTimes(1);
        expect(h.onCancelHold).not.toHaveBeenCalled();
        expect(h.ticks.cleared).toBe(1);
    });

    it('cancel while counting returns true and calls onCancelHold once', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        let result;
        act(() => {
            result = h.result.current.cancel();
        });
        expect(result).toBe(true);
        expect(h.result.current.status).toBe('cancelled');
        expect(h.onCancelHold).toHaveBeenCalledTimes(1);
        expect(h.onElapsed).not.toHaveBeenCalled();
        expect(h.ticks.cleared).toBe(1);
    });

    it('cancel when idle or after elapse returns false and calls nothing', () => {
        const h = setup();
        let result;
        act(() => {
            result = h.result.current.cancel();
        });
        expect(result).toBe(false);

        act(() => h.result.current.start(2));
        h.advance(2000);
        act(() => {
            result = h.result.current.cancel();
        });
        expect(result).toBe(false);
        expect(h.onCancelHold).not.toHaveBeenCalled();
        expect(h.onElapsed).toHaveBeenCalledTimes(1);
    });

    it('start(0) elapses at once with no tick armed', () => {
        const h = setup();
        act(() => h.result.current.start(0));
        expect(h.result.current.status).toBe('elapsed');
        expect(h.onElapsed).toHaveBeenCalledTimes(1);
        expect(h.ticks.armed).toBe(0);
    });

    it('a second start while counting throws', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        expect(() => h.result.current.start(5)).toThrow();
        expect(h.result.current.status).toBe('counting');
    });

    it('restarts after cancelled and after elapsed', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        act(() => {
            h.result.current.cancel();
        });
        act(() => h.result.current.start(3));
        expect(h.result.current.status).toBe('counting');
        expect(h.result.current.remaining).toBe(3);

        h.advance(3000);
        expect(h.result.current.status).toBe('elapsed');
        act(() => h.result.current.start(4));
        expect(h.result.current.status).toBe('counting');
        expect(h.result.current.remaining).toBe(4);
    });

    it('honours a swapped onCancelHold without restarting the countdown', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        const swapped = vi.fn();
        h.rerender({ ...h.props, onCancelHold: swapped });
        expect(h.ticks.armed).toBe(1);
        act(() => {
            h.result.current.cancel();
        });
        expect(swapped).toHaveBeenCalledTimes(1);
        expect(h.onCancelHold).not.toHaveBeenCalled();
    });

    it('unmount while counting clears the tick and runs no callback', () => {
        const h = setup();
        act(() => h.result.current.start(5));
        h.unmount();
        expect(h.ticks.cleared).toBe(1);
        expect(h.onElapsed).not.toHaveBeenCalled();
        expect(h.onCancelHold).not.toHaveBeenCalled();
    });
});
