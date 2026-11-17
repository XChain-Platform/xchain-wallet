// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    MULTIPART_WAVE_PIECES,
    multipartTransactionCount,
    multipartWaveCount,
    multipartWaveRanges,
} from '../../../packages/core/src/flows/multipartWaves.js';

describe('multipart transaction waves', () => {
    it('uses waves of 100 pieces', () => {
        expect(MULTIPART_WAVE_PIECES).toBe(100);
    });

    it.each([
        [99, 1, 201],
        [100, 2, 204],
        [101, 2, 206],
    ])('maps %i parts to %i waves and %i transactions', (parts, waves, transactions) => {
        expect(multipartWaveCount(parts)).toBe(waves);
        expect(multipartTransactionCount(parts)).toBe(transactions);
    });

    it('includes the manifest first in ordered wave ranges', () => {
        expect(multipartWaveRanges(250)).toEqual([
            { index: 0, from: 0, to: 99 },
            { index: 1, from: 100, to: 199 },
            { index: 2, from: 200, to: 250 },
        ]);
        expect(multipartTransactionCount(250)).toBe(505);
    });
});
