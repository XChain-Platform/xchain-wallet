// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSendThrottle } from '../../../packages/core/src/watch/watchSendThrottle.js';

describe('createSendThrottle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends the first offer immediately', () => {
        const send = vi.fn();
        const throttle = createSendThrottle({ send });

        throttle.offer('first');

        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenLastCalledWith('first');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sends only the last offer in a window when 30 seconds elapse', () => {
        const send = vi.fn();
        const throttle = createSendThrottle({ send });

        throttle.offer('first');
        vi.advanceTimersByTime(1_000);
        throttle.offer('second');
        throttle.offer('third');
        throttle.offer('last');

        expect(send).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        vi.advanceTimersByTime(28_999);
        expect(send).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith('last');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sends an urgent offer immediately and drops the held offer', () => {
        const send = vi.fn();
        const throttle = createSendThrottle({ send });

        throttle.offer('first');
        throttle.offer('held');
        throttle.offer('urgent', { urgent: true });

        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith('urgent');
        expect(vi.getTimerCount()).toBe(0);

        vi.advanceTimersByTime(30_000);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('cancels a held offer without sending it', () => {
        const send = vi.fn();
        const throttle = createSendThrottle({ send });

        throttle.offer('first');
        throttle.offer('held');
        throttle.cancel();

        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(30_000);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('swallows thrown and rejected sends and does not retry them', async () => {
        const send = vi.fn()
            .mockImplementationOnce(() => { throw new Error('thrown'); })
            .mockRejectedValueOnce(new Error('rejected'))
            .mockResolvedValueOnce(undefined);
        const throttle = createSendThrottle({ send });

        expect(() => throttle.offer('throws')).not.toThrow();
        throttle.offer('after throw');
        expect(send).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(send).toHaveBeenNthCalledWith(2, 'after throw');

        throttle.offer('after rejection');
        await vi.advanceTimersByTimeAsync(30_000);

        expect(send).toHaveBeenCalledTimes(3);
        expect(send).toHaveBeenNthCalledWith(3, 'after rejection');
        expect(vi.getTimerCount()).toBe(0);
    });
});
