// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { createUndoSendController } from '../../../packages/core/src/flows/undoSend.js';

function harness() {
    const clock = { t: 5_000 };
    const ticks = { fn: null, ms: null, cleared: 0 };
    const onTick = vi.fn();
    const onElapsed = vi.fn();
    const onCancel = vi.fn();
    const controller = createUndoSendController({
        onTick,
        onElapsed,
        onCancel,
        now: () => clock.t,
        setTick: (fn, ms) => {
            ticks.fn = fn;
            ticks.ms = ms;
            return 42;
        },
        clearTick: (h) => {
            expect(h).toBe(42);
            ticks.cleared += 1;
            ticks.fn = null;
        },
    });
    const advance = (ms) => {
        clock.t += ms;
        ticks.fn?.();
    };
    return { controller, onTick, onElapsed, onCancel, ticks, advance };
}

describe('undo-send controller', () => {
    it('starts idle', () => {
        expect(harness().controller.state()).toBe('idle');
    });

    it('start enters counting and ticks at once', () => {
        const h = harness();
        h.controller.start(3);

        expect(h.controller.state()).toBe('counting');
        expect(h.onTick).toHaveBeenCalledTimes(1);
        expect(h.onTick).toHaveBeenLastCalledWith(3);
        expect(h.ticks.ms).toBe(1000);
    });

    it('initial tick uses the remaining-seconds math with a fresh clock read', () => {
        const reads = [5_000, 6_500];
        const onTick = vi.fn();
        const c = createUndoSendController({
            onTick,
            now: () => reads.shift() ?? 6_500,
            setTick: () => 1,
            clearTick: () => {},
        });
        c.start(3);

        expect(onTick).toHaveBeenCalledTimes(1);
        expect(onTick).toHaveBeenLastCalledWith(2);
    });

    it('initial tick keeps a fractional window as given', () => {
        const h = harness();
        h.controller.start(2.5);
        expect(h.onTick).toHaveBeenLastCalledWith(2.5);
    });

    it('ticks down each second then elapses once', () => {
        const h = harness();
        h.controller.start(3);
        h.advance(1000);
        expect(h.onTick).toHaveBeenLastCalledWith(2);
        h.advance(1000);
        expect(h.onTick).toHaveBeenLastCalledWith(1);
        expect(h.onElapsed).not.toHaveBeenCalled();
        h.advance(1000);

        expect(h.onTick).toHaveBeenLastCalledWith(0);
        expect(h.controller.state()).toBe('elapsed');
        expect(h.onElapsed).toHaveBeenCalledTimes(1);
        expect(h.ticks.cleared).toBe(1);
        expect(h.onCancel).not.toHaveBeenCalled();
    });

    it('elapses on a late tick past the window', () => {
        const h = harness();
        h.controller.start(3);
        h.advance(9000);

        expect(h.onTick).toHaveBeenLastCalledWith(0);
        expect(h.controller.state()).toBe('elapsed');
        expect(h.onElapsed).toHaveBeenCalledTimes(1);
        expect(h.ticks.cleared).toBe(1);
    });

    it('start(0) elapses at once with no tick', () => {
        const h = harness();
        h.controller.start(0);

        expect(h.controller.state()).toBe('elapsed');
        expect(h.onElapsed).toHaveBeenCalledTimes(1);
        expect(h.onTick).not.toHaveBeenCalled();
        expect(h.ticks.fn).toBeNull();
        expect(h.ticks.ms).toBeNull();
    });

    it.each([-1, NaN, Infinity, -Infinity, undefined, '3'])(
        'start(%s) throws a TypeError',
        (bad) => {
            const h = harness();
            expect(() => h.controller.start(bad)).toThrow(TypeError);
            expect(h.controller.state()).toBe('idle');
        },
    );

    it('start while counting throws', () => {
        const h = harness();
        h.controller.start(3);
        expect(() => h.controller.start(3)).toThrow();
        expect(h.controller.state()).toBe('counting');
    });

    it('cancel while counting clears the tick and calls onCancel once', () => {
        const h = harness();
        h.controller.start(3);

        expect(h.controller.cancel()).toBe(true);
        expect(h.controller.state()).toBe('cancelled');
        expect(h.onCancel).toHaveBeenCalledTimes(1);
        expect(h.ticks.cleared).toBe(1);
        expect(h.controller.cancel()).toBe(false);
        expect(h.onCancel).toHaveBeenCalledTimes(1);
        expect(h.onElapsed).not.toHaveBeenCalled();
    });

    it('cancel when idle returns false and calls nothing', () => {
        const h = harness();
        expect(h.controller.cancel()).toBe(false);
        expect(h.onCancel).not.toHaveBeenCalled();
        expect(h.controller.state()).toBe('idle');
    });

    it('cancel after elapse returns false and calls nothing', () => {
        const h = harness();
        h.controller.start(2);
        h.advance(2000);

        expect(h.controller.cancel()).toBe(false);
        expect(h.onCancel).not.toHaveBeenCalled();
        expect(h.controller.state()).toBe('elapsed');
    });

    it('works with no callbacks', () => {
        const c = createUndoSendController({ setTick: () => 1, clearTick: () => {} });
        c.start(1);
        expect(c.cancel()).toBe(true);
    });
});
