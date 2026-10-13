// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickQuizPositions } from '../../../../packages/core/src/shared/utils/pickQuizPositions.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('pickQuizPositions', () => {
    it.each([
        [12, 3],
        [18, 3],
        [24, 4],
        [36, 6],
    ])('scales a %i-word quiz to %i positions', (totalWords, expectedCount) => {
        vi.spyOn(Math, 'random').mockReturnValue(0.999999);

        expect(pickQuizPositions(totalWords)).toHaveLength(expectedCount);
    });

    it('returns sorted, unique, non-adjacent positions after the first word', () => {
        let state = 7;
        vi.spyOn(Math, 'random').mockImplementation(() => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 0x100000000;
        });

        const positions = pickQuizPositions(24);

        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(new Set(positions).size).toBe(positions.length);
        expect(positions.every((position) => position >= 2 && position <= 24)).toBe(true);
        expect(positions.every((position, index) => (
            index === 0 || position - positions[index - 1] > 1
        ))).toBe(true);
    });

    it('uses the shuffled order to choose positions', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(pickQuizPositions(12)).toEqual([3, 5, 7]);

        vi.mocked(Math.random).mockReturnValue(0.999999);
        expect(pickQuizPositions(12)).toEqual([2, 4, 6]);
    });

    it.each([
        [0, []],
        [1, []],
        [2, [2]],
    ])('handles a %i-word input with the available positions', (totalWords, expected) => {
        vi.spyOn(Math, 'random').mockReturnValue(0.999999);

        expect(pickQuizPositions(totalWords)).toEqual(expected);
    });

    it('returns the available non-adjacent subset when the three-position floor cannot be met', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        expect(pickQuizPositions(6)).toEqual([3, 5]);
    });
});
