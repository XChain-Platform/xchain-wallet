// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    createSignThrottle,
    SIGN_THROTTLE_DEFAULT_BURST,
    SIGN_THROTTLE_DEFAULT_WINDOW_MS,
} from '../../../packages/core/src/flows/signThrottle.js';

describe('sign throttle branch behavior', () => {
    it('coerces invalid static limits and accepts positive fractions', () => {
        expect(createSignThrottle({ burst: 0, windowMs: Number.NaN })).toMatchObject({
            burst: SIGN_THROTTLE_DEFAULT_BURST,
            windowMs: SIGN_THROTTLE_DEFAULT_WINDOW_MS,
        });
        expect(createSignThrottle({ burst: 2.9, windowMs: 10.9 })).toMatchObject({
            burst: 2,
            windowMs: 10,
        });
    });

    it('filters malformed hydration and throttles only valid origins', () => {
        let time = 100;
        const throttle = createSignThrottle({
            burst: 2,
            windowMs: 20,
            now: () => time,
            initialState: {
                buckets: {
                    'https://valid.example': [90],
                    '': [90],
                    badArray: '90',
                    badTimestamp: [Number.NaN],
                },
            },
        });

        expect(throttle.snapshot()).toEqual({ buckets: { 'https://valid.example': [90] } });
        expect(throttle.check('')).toEqual({ allowed: true });
        expect(throttle.check(null)).toEqual({ allowed: true });
        expect(throttle.check('https://valid.example')).toEqual({ allowed: true });
        expect(throttle.check('https://valid.example')).toEqual({
            allowed: false,
            retryAfterMs: 10,
            burst: 2,
            windowMs: 20,
        });

        time = 111;
        expect(throttle.check('https://valid.example')).toEqual({ allowed: true });
        expect(throttle.snapshot().buckets['https://valid.example']).toEqual([100, 111]);
    });

    it('reads live limits and falls back when the live provider omits them', () => {
        let limits = null;
        const throttle = createSignThrottle({
            burst: 3,
            windowMs: 30,
            getLimits: () => limits,
            now: () => 10,
        });

        expect(throttle.getLimits()).toEqual({ burst: 3, windowMs: 30 });
        limits = { burst: 1.8, windowMs: -1 };
        expect(throttle.getLimits()).toEqual({
            burst: 1,
            windowMs: SIGN_THROTTLE_DEFAULT_WINDOW_MS,
        });
        expect(throttle.check('https://live.example')).toEqual({ allowed: true });
        expect(throttle.check('https://live.example').allowed).toBe(false);
    });

    it('persists mutations and tolerates synchronous and asynchronous failures', async () => {
        const snapshots = [];
        const throttle = createSignThrottle({
            onPersist: vi.fn((snapshot) => {
                snapshots.push(snapshot);
                return Promise.reject(new Error('storage unavailable'));
            }),
            now: () => 5,
        });
        throttle.check('https://one.example');
        throttle.clear('https://one.example');
        throttle.check('https://two.example');
        throttle.clear();
        await Promise.resolve();

        expect(snapshots).toEqual([
            { buckets: { 'https://one.example': [5] } },
            { buckets: {} },
            { buckets: { 'https://two.example': [5] } },
            { buckets: {} },
        ]);

        const throwing = createSignThrottle({ onPersist: () => { throw new Error('disk'); } });
        expect(() => throwing.check('https://safe.example')).not.toThrow();
    });

    it('merges valid seed timestamps without collapsing equal calls', () => {
        const throttle = createSignThrottle({
            initialState: { buckets: { 'https://seed.example': [20] } },
        });
        throttle.seed(null);
        throttle.seed([]);
        throttle.seed({
            '': [1],
            wrong: '2',
            empty: [Number.NaN],
            'https://seed.example': [20, Number.POSITIVE_INFINITY, 10],
        });

        expect(throttle.snapshot()).toEqual({
            buckets: { 'https://seed.example': [10, 20, 20] },
        });
    });
});
