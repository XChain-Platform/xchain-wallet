// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingRequestSlot } from '../../../packages/core/src/watch/watchHost.js';

describe('createPendingRequestSlot', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('holds an open confirm without arming a timer', () => {
        const onChange = vi.fn();
        const slot = createPendingRequestSlot({ onChange });
        const request = { id: 'confirm-1', kind: 'confirm' };

        slot.set(request);

        expect(slot.get()).toBe(request);
        expect(vi.getTimerCount()).toBe(0);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenLastCalledWith(request);
    });

    it('clears a pay request exactly when its expiry is reached', () => {
        const onChange = vi.fn();
        const slot = createPendingRequestSlot({ onChange });
        const request = { id: 'pay-1', kind: 'pay', expiresAt: 1_500 };

        slot.set(request);
        vi.advanceTimersByTime(499);

        expect(slot.get()).toBe(request);
        expect(onChange).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);

        expect(slot.get()).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('replaces the held request and disarms its expiry timer', () => {
        const onChange = vi.fn();
        const slot = createPendingRequestSlot({ onChange });
        const first = { id: 'pay-1', expiresAt: 1_100 };
        const second = { id: 'pay-2', expiresAt: 1_300 };

        slot.set(first);
        slot.set(second);
        vi.advanceTimersByTime(100);

        expect(slot.get()).toBe(second);
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);

        vi.advanceTimersByTime(200);

        expect(slot.get()).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(3);
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it('refuses pay requests that are already due without changing the slot', () => {
        const onChange = vi.fn();
        const slot = createPendingRequestSlot({ onChange });
        const held = { id: 'confirm-1' };

        slot.set(held);
        slot.set({ id: 'pay-due', expiresAt: 1_000 });
        slot.set({ id: 'pay-past', expiresAt: 999 });

        expect(slot.get()).toBe(held);
        expect(onChange).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears only a matching id and disarms the pending timer', () => {
        const onChange = vi.fn();
        const slot = createPendingRequestSlot({ onChange });
        const request = { id: 'pay-1', expiresAt: 1_500 };

        slot.set(request);
        slot.clear('pay-2');

        expect(slot.get()).toBe(request);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        slot.clear('pay-1');

        expect(slot.get()).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(vi.getTimerCount()).toBe(0);

        vi.advanceTimersByTime(500);
        slot.clear();
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('clears the held request when no id is supplied', () => {
        const onChange = vi.fn();
        const slot = createPendingRequestSlot({ onChange });

        slot.set({ id: 'confirm-1' });
        slot.clear();

        expect(slot.get()).toBeNull();
        expect(onChange).toHaveBeenNthCalledWith(2, null);
    });
});
