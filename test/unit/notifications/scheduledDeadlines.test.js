// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { syncDeadlineSchedule } from '../../../packages/core/src/notifications/scheduledDeadlines.js';

const NOW = 2_000_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function result(key, hours, title = key) {
    return {
        key,
        deadlineMs: NOW + hours * HOUR_MS,
        kind: 'deadline',
        title,
        body: `${title} is approaching.`,
    };
}

function adapter() {
    return {
        schedule: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
    };
}

describe('syncDeadlineSchedule', () => {
    it('schedules DeadlineWatcher results at the default warning time with stable ids', async () => {
        const notify = adapter();

        const plan = await syncDeadlineSchedule([
            result('btc:order:4', 1, 'Order 4'),
            result('btc:swap:8', 26, 'Swap 8'),
        ], {
            notify,
            previousIds: ['deadline:btc:poll:resolved'],
            now: NOW,
        });

        expect(notify.schedule).toHaveBeenNthCalledWith(1, {
            id: 'deadline:btc:order:4',
            at: NOW + 60_000,
            kind: 'deadline',
            title: 'Order 4',
            body: 'Order 4 is approaching.',
        }, NOW + 60_000);
        expect(notify.schedule).toHaveBeenNthCalledWith(2, {
            id: 'deadline:btc:swap:8',
            at: NOW + 2 * HOUR_MS,
            kind: 'deadline',
            title: 'Swap 8',
            body: 'Swap 8 is approaching.',
        }, NOW + 2 * HOUR_MS);
        expect(plan.map(({ id }) => id)).toEqual([
            'deadline:btc:order:4',
            'deadline:btc:swap:8',
        ]);
        expect(notify.cancel).toHaveBeenCalledWith('deadline:btc:poll:resolved');
        expect(notify.cancel.mock.invocationCallOrder[0])
            .toBeLessThan(notify.schedule.mock.invocationCallOrder[0]);
    });

    it('keeps the nearest 48 and does not reschedule ids already pending', async () => {
        const notify = adapter();
        const items = Array.from({ length: 50 }, (_, index) => (
            result(`btc:poll:${String(index).padStart(2, '0')}`, index + 25)
        ));
        const previousIds = ['deadline:btc:poll:00'];

        const plan = await syncDeadlineSchedule(items, {
            notify,
            previousIds,
            now: NOW,
        });

        expect(plan).toHaveLength(48);
        expect(notify.schedule).toHaveBeenCalledTimes(47);
        expect(notify.cancel).not.toHaveBeenCalled();
        expect(plan.at(-1).key).toBe('btc:poll:47');
    });

    it('cancels pending ids when every supported deadline kind resolves', async () => {
        const notify = adapter();
        const previousIds = [
            'deadline:btc:order:1',
            'deadline:btc:swap:2',
            'deadline:btc:dispenser:3',
            'deadline:btc:poll:4',
        ];

        const plan = await syncDeadlineSchedule([], {
            notify,
            previousIds,
            now: NOW,
        });

        expect(plan).toEqual([]);
        expect(notify.cancel.mock.calls.map(([id]) => id)).toEqual(previousIds);
        expect(notify.schedule).not.toHaveBeenCalled();
    });

    it('uses an injected window and rejects an adapter without native scheduling', async () => {
        const notify = adapter();

        await syncDeadlineSchedule([result('btc:dispenser:3', 3)], {
            notify,
            now: NOW,
            windowSeconds: HOUR_MS / 1000,
        });
        expect(notify.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'deadline:btc:dispenser:3' }),
            NOW + 2 * HOUR_MS,
        );

        await expect(syncDeadlineSchedule([], { notify: vi.fn() }))
            .rejects.toThrow(/schedulable notify adapter/);
    });
});
