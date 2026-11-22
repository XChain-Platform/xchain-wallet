// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createApprovalParking } from '../../../packages/core/src/site_request/approvalParking.js';

function fakeTimers() {
    let nextTimer = 1;
    const pending = new Map();
    const setTimer = vi.fn((callback, delay) => {
        const timer = nextTimer;
        nextTimer += 1;
        pending.set(timer, callback);
        return timer;
    });
    const clearTimer = vi.fn((timer) => pending.delete(timer));
    const fire = (timer) => pending.get(timer)?.();
    return { setTimer, clearTimer, fire, pending };
}

function parkingWithIds(...ids) {
    const timers = fakeTimers();
    const parking = createApprovalParking({
        newId: vi.fn(() => ids.shift()),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });
    return { parking, timers };
}

describe('createApprovalParking', () => {
    it('keeps a parked promise pending until resolve returns its exact result', async () => {
        const { parking } = parkingWithIds('request-1');
        const pending = parking.park('sign', { origin: 'https://one.test' });
        let settled = false;
        pending.then(() => {
            settled = true;
        });

        await Promise.resolve();
        expect(settled).toBe(false);

        const result = { approved: true, signature: 'signed' };
        expect(parking.resolve('request-1', result)).toBe(true);
        await expect(pending).resolves.toBe(result);
        expect(parking.resolve('request-1', { approved: false })).toBe(false);
    });

    it('fetches copies and lists parked entries oldest first until settled', async () => {
        const { parking } = parkingWithIds('older', 'newer');
        const olderPayload = { origin: 'https://older.test' };
        const newerPayload = { origin: 'https://newer.test' };
        const older = parking.park('connect', olderPayload);
        const newer = parking.park('sign', newerPayload);

        const fetched = parking.fetch('older');
        expect(fetched).toEqual({ id: 'older', kind: 'connect', payload: olderPayload });
        expect(parking.fetch('older')).not.toBe(fetched);
        expect(parking.list()).toEqual([
            { id: 'older', kind: 'connect', payload: olderPayload },
            { id: 'newer', kind: 'sign', payload: newerPayload },
        ]);

        parking.resolve('older', 'done');
        await expect(older).resolves.toBe('done');
        expect(parking.fetch('older')).toBeNull();
        expect(parking.list()).toEqual([
            { id: 'newer', kind: 'sign', payload: newerPayload },
        ]);
        parking.cancelAll();
        await newer;
    });

    it('times out with a refusal and removes the request', async () => {
        const { parking, timers } = parkingWithIds('timed-out');
        const pending = parking.park('connect', { origin: 'https://slow.test' });
        const timer = timers.setTimer.mock.results[0].value;

        expect(timers.setTimer).toHaveBeenCalledWith(expect.any(Function), 300000);
        timers.fire(timer);

        await expect(pending).resolves.toEqual({ approved: false });
        expect(parking.fetch('timed-out')).toBeNull();
        expect(parking.resolve('timed-out', { approved: true })).toBe(false);
        expect(timers.clearTimer).toHaveBeenCalledWith(timer);
    });

    it('cancels only matching origins, then cancels every remaining request', async () => {
        const { parking } = parkingWithIds('one', 'two', 'three');
        const one = parking.park('sign', { origin: 'https://selected.test' });
        const two = parking.park('connect', { origin: 'https://kept.test' });
        const three = parking.park('sign', { origin: 'https://selected.test' });

        expect(parking.cancelOriginsMatching((origin) => origin === 'https://selected.test')).toBe(2);
        await expect(one).resolves.toEqual({ approved: false });
        await expect(three).resolves.toEqual({ approved: false });
        expect(parking.list()).toEqual([
            { id: 'two', kind: 'connect', payload: { origin: 'https://kept.test' } },
        ]);

        expect(parking.cancelAll()).toBe(1);
        await expect(two).resolves.toEqual({ approved: false });
        expect(parking.cancelAll()).toBe(0);
        expect(parking.list()).toEqual([]);
    });

    it('rejects a missing id source and a non-function origin predicate', () => {
        expect(() => createApprovalParking()).toThrow(TypeError);
        const { parking } = parkingWithIds();
        expect(() => parking.cancelOriginsMatching('https://one.test')).toThrow(TypeError);
    });

    it('notifies subscribers after park and settle until unsubscribed', async () => {
        const { parking } = parkingWithIds('first', 'second');
        const listener = vi.fn();
        const unsubscribe = parking.subscribe(listener);

        const first = parking.park('connect', { origin: 'https://one.test' });
        expect(listener).toHaveBeenCalledTimes(1);
        parking.resolve('first', { approved: true });
        await first;
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        const second = parking.park('sign', { origin: 'https://two.test' });
        parking.cancelAll();
        await second;
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
