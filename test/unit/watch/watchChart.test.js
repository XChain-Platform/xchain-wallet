// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { watchChart } from '../../../packages/core/src/watch/watchChart.js';

describe('watchChart', () => {
    it('downsamples 168 hourly points to 48 bucket means and keeps the last point', () => {
        const source = Array.from({ length: 168 }, (_, index) => index + 1);
        const chart = watchChart(source);

        expect(chart.points).toHaveLength(48);
        expect(chart.points[0]).toBe(2);
        expect(chart.points.at(-2)).toBe(165.5);
        expect(chart.points.at(-1)).toBe(168);
        expect(chart.up).toBe(true);
    });

    it('marks a falling series as down after dropping invalid points', () => {
        expect(watchChart([9, NaN, 7, Infinity, 0, -1, 4])).toEqual({
            points: [9, 7, 4],
            up: false,
        });

        const falling = [100, ...Array(166).fill(1), 50];
        const chart = watchChart(falling);
        expect(chart.points[0]).toBe(34);
        expect(chart.points.at(-1)).toBe(50);
        expect(chart.up).toBe(false);
    });

    it('returns no chart with fewer than two usable points', () => {
        expect(watchChart([])).toBeNull();
        expect(watchChart([NaN, 0, -4, Infinity])).toBeNull();
        expect(watchChart([3])).toBeNull();
        expect(watchChart(null)).toBeNull();
    });
});
