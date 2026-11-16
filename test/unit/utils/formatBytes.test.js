// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The one byte-size formatter: KB and MB on base 1024, never bytes, a limit
// rounded down and a size rounded up.

import { describe, expect, it } from 'vitest';
import { formatBytes, reachedEightyPercent } from '../../../packages/core/src/shared/utils/formatBytes.js';

describe('formatBytes', () => {
    it('reads in KB and MB on base 1024, dropping a trailing .0', () => {
        expect(formatBytes(262144)).toBe('256 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(1048576)).toBe('1 MB');
        expect(formatBytes(65536, { limit: true })).toBe('64 KB');
    });

    it('never prints bytes, and a non-empty size never reads as 0 KB', () => {
        expect(formatBytes(1)).toBe('0.1 KB');
        expect(formatBytes(512)).toBe('0.5 KB');
        expect(formatBytes(0)).toBe('0 KB');
        for (const n of [0, 1, 12, 900, 5000, 2_000_000]) {
            expect(formatBytes(n)).not.toMatch(/byte/);
            expect(formatBytes(n, { limit: true })).not.toMatch(/byte/);
        }
    });

    it('rounds a limit down, never overstating the room', () => {
        expect(formatBytes(8144, { limit: true })).toBe('7.9 KB');
        expect(formatBytes(7792, { limit: true })).toBe('7.6 KB');
        expect(formatBytes(389946, { limit: true })).toBe('380.8 KB');
        expect(formatBytes(838861, { limit: true })).toBe('819.2 KB');
        expect(formatBytes(3.25 * 1024 * 1024, { limit: true })).toBe('3.2 MB');
    });

    it('rounds a size up, so a file just over a limit never reads as under it', () => {
        expect(formatBytes(8145)).toBe('8 KB');
        expect(formatBytes(838861)).toBe('819.3 KB');
        expect(formatBytes(8145)).not.toBe(formatBytes(8144, { limit: true }));
    });

    it('treats a missing or invalid count as nothing', () => {
        expect(formatBytes(undefined)).toBe('0 KB');
        expect(formatBytes(-5)).toBe('0 KB');
        expect(formatBytes(Number.NaN, { limit: true })).toBe('0 KB');
    });
});

describe('reachedEightyPercent', () => {
    it('flips at 80 percent of the limit', () => {
        expect(reachedEightyPercent(8191, 8192 * 1)).toBe(true);
        expect(reachedEightyPercent(9, 8192)).toBe(false);
        expect(reachedEightyPercent(6553, 8192)).toBe(false);
        expect(reachedEightyPercent(6554, 8192)).toBe(true);
    });
});
