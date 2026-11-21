// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    diffDeadlineSchedule,
    planDeadlineSchedule,
} from '../../../packages/core/src/notifications/scheduledDeadlines.js';

const NOW = 2_000_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

describe('planDeadlineSchedule', () => {
    it('drops passed deadlines and applies the default warning window', () => {
        const plan = planDeadlineSchedule([
            { key: 'btc:order:past', deadlineMs: NOW - 1 },
            { key: 'btc:order:now', deadlineMs: NOW },
            { key: 'btc:order:soon', deadlineMs: NOW + HOUR_MS },
            { key: 'btc:order:later', deadlineMs: NOW + 26 * HOUR_MS },
        ], { now: NOW });

        expect(plan).toEqual([
            {
                key: 'btc:order:soon',
                deadlineMs: NOW + HOUR_MS,
                id: 'deadline:btc:order:soon',
                at: NOW + 60_000,
            },
            {
                key: 'btc:order:later',
                deadlineMs: NOW + 26 * HOUR_MS,
                id: 'deadline:btc:order:later',
                at: NOW + 2 * HOUR_MS,
            },
        ]);
    });

    it('orders by fire time then key and keeps only the requested limit', () => {
        const items = [
            { key: 'chain:swap:z', deadlineMs: NOW + 20_000 },
            { key: 'chain:swap:a', deadlineMs: NOW + 30_000 },
            { key: 'chain:swap:later', deadlineMs: NOW + 4 * HOUR_MS },
        ];

        const plan = planDeadlineSchedule(items, {
            now: NOW,
            windowSeconds: 60 * 60,
            limit: 2,
        });

        expect(plan.map(({ key, at }) => ({ key, at }))).toEqual([
            { key: 'chain:swap:a', at: NOW + 60_000 },
            { key: 'chain:swap:z', at: NOW + 60_000 },
        ]);
        expect(items).toEqual([
            { key: 'chain:swap:z', deadlineMs: NOW + 20_000 },
            { key: 'chain:swap:a', deadlineMs: NOW + 30_000 },
            { key: 'chain:swap:later', deadlineMs: NOW + 4 * HOUR_MS },
        ]);
    });

    it('defaults to the nearest 48 entries', () => {
        const items = Array.from({ length: 50 }, (_, index) => ({
            key: `chain:poll:${String(index).padStart(2, '0')}`,
            deadlineMs: NOW + (index + 2) * HOUR_MS,
        }));

        const plan = planDeadlineSchedule(items, { now: NOW });

        expect(plan).toHaveLength(48);
        expect(plan.at(-1).key).toBe('chain:poll:47');
    });
});

describe('diffDeadlineSchedule', () => {
    it('schedules new entries and cancels ids no longer planned', () => {
        const plan = planDeadlineSchedule([
            { key: 'btc:order:kept', deadlineMs: NOW + HOUR_MS },
            { key: 'btc:swap:new', deadlineMs: NOW + 2 * HOUR_MS },
        ], { now: NOW });

        expect(diffDeadlineSchedule([
            'deadline:btc:order:kept',
            'deadline:btc:poll:closed',
        ], plan)).toEqual({
            schedule: [plan[1]],
            cancel: ['deadline:btc:poll:closed'],
        });
    });
});
