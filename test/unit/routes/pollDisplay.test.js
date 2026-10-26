// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    latestBallotRows,
    pollRowForDisplay,
    pollResultPercentages,
    samePollIndex,
} from '../../../packages/core/src/shared/routes/pollDisplay.js';

const VOTER = 'bc1qvotervotervotervotervotervoterxx';

const EQUAL_WEIGHT_RESULTS = Object.freeze([
    Object.freeze({ option_index: 0, total_weight: '9007199254740993', voter_count: 100 }),
    Object.freeze({ option_index: 1, total_weight: '9007199254740993', voter_count: 2 }),
    Object.freeze({ option_index: 2, total_weight: '9007199254740993', voter_count: 1 }),
]);

const DELEGATED_WEIGHT_RESULTS = Object.freeze([
    Object.freeze({
        option_index: 0,
        total_weight: '60',
        direct_weight: '40',
        delegated_weight: '20',
        voter_count: 1,
    }),
    Object.freeze({
        option_index: 1,
        total_weight: '40',
        direct_weight: '40',
        delegated_weight: '0',
        voter_count: 9,
    }),
]);

const BALLOT_ROWS = Object.freeze([
    Object.freeze({ action_index: '9007199254740992', source: VOTER, choice: 0, share: '1' }),
    Object.freeze({ action_index: '9007199254740993', source: VOTER, choice: 1, share: '3' }),
    Object.freeze({ action_index: '9007199254740993', source: VOTER, choice: 2, share: '2' }),
    Object.freeze({ action_index: '9007199254740994', source: 'bc1qdelegate', choice: 0, share: '1' }),
]);

describe('poll display calculations', () => {
    it('allocates exact large equal weights to whole percentages totaling 100', () => {
        const percentages = pollResultPercentages(EQUAL_WEIGHT_RESULTS);

        expect(percentages).toEqual([34, 33, 33]);
        expect(percentages.reduce((sum, value) => sum + value, 0)).toBe(100);
    });

    it('uses each frozen total weight without recounting voters or delegated components', () => {
        expect(pollResultPercentages(DELEGATED_WEIGHT_RESULTS)).toEqual([60, 40]);
    });

    it('keeps the latest complete direct ballot beyond the safe integer range', () => {
        expect(latestBallotRows(BALLOT_ROWS, VOTER)).toEqual([
            BALLOT_ROWS[1],
            BALLOT_ROWS[2],
        ]);
    });

    it('compares poll indexes exactly past the safe integer range and enforces uint64', () => {
        expect(samePollIndex('9007199254740993', '9007199254740993')).toBe(true);
        expect(samePollIndex('9007199254740993', '9007199254740992')).toBe(false);
        expect(samePollIndex('18446744073709551616', '18446744073709551616')).toBe(false);
    });

    it('accepts either poll id alias but rejects a row whose aliases disagree', () => {
        expect(pollRowForDisplay({ poll_index: 7, options: [] })?.action_index).toBe(7);
        expect(pollRowForDisplay({ action_index: '7', poll_index: 8, options: [] })).toBeNull();
    });
});
