// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The poll page's result card and the list's pill share these: a closed
// poll states its outcome (Approved, Rejected, No quorum), the card names
// the leading option and its share, and time left reads as a duration.

import { describe, expect, it } from 'vitest';
import {
    blocksDurationText,
    pollOutcome,
    pollResultSummary,
    pollStatusLabel,
} from '../../../packages/core/src/shared/routes/pollDisplay.js';

describe('pollOutcome', () => {
    it('reads no quorum from a failed turnout gate', () => {
        expect(pollOutcome({ poll_status: 'failed_quorum' })).toBe('no_quorum');
        expect(pollStatusLabel('failed_quorum', 'no_quorum')).toBe('No quorum');
    });

    it('reads Approved or Rejected from a yes/no winner, and Decided otherwise', () => {
        expect(pollOutcome({ poll_status: 'finalized', options: ['Yes', 'No'], winning_option: 0 })).toBe('approved');
        expect(pollOutcome({ poll_status: 'finalized', options: ['Yes', 'No'], winning_option: 1 })).toBe('rejected');
        expect(pollOutcome({ poll_status: 'finalized', options: ['Alpha', 'Beta'], winning_option: 1 })).toBe('decided');
        expect(pollOutcome({ poll_status: 'finalized', options: ['Alpha'], winning_option: null })).toBe('decided');
        // Only an exact two-option yes/no pair reads as Approved or Rejected.
        expect(pollOutcome({ poll_status: 'finalized', options: ['No fee', 'Low fee'], winning_option: 0 })).toBe('decided');
        expect(pollOutcome({ poll_status: 'finalized', options: ['Yes', 'No', 'Abstain'], winning_option: 0 })).toBe('decided');
        expect(pollOutcome({ poll_status: 'finalized', options: ['Against', 'For'], winning_option: 1 })).toBe('approved');
        expect(pollStatusLabel('finalized', 'approved')).toBe('Approved');
        expect(pollStatusLabel('finalized', 'rejected')).toBe('Rejected');
    });

    it('honours an explicit outcome on the row and stays null while open', () => {
        expect(pollOutcome({ poll_status: 'finalized', outcome: 'rejected', options: ['Yes'], winning_option: 0 })).toBe('rejected');
        expect(pollOutcome({ poll_status: 'open' })).toBeNull();
        expect(pollOutcome({ poll_status: 'pending' })).toBeNull();
    });
});

describe('pollResultSummary', () => {
    it('names the leading option with its whole-percent share and per-option totals', () => {
        const summary = pollResultSummary([
            { option_index: 0, total_weight: '30', voter_count: 3 },
            { option_index: 1, total_weight: '70.5', voter_count: 1 },
        ], ['Stable', 'Preview']);
        expect(summary.leading).toEqual({ optionIndex: 1, label: 'Preview', weight: '70.5', percent: 70, voters: 1 });
        expect(summary.entries.map((entry) => entry.percent)).toEqual([30, 70]);
        expect(summary.tie).toBe(false);
    });

    it('reports a tie at the top instead of a leader, and nothing for an empty tally', () => {
        const tied = pollResultSummary([
            { option_index: 0, total_weight: '9007199254740993', voter_count: 1 },
            { option_index: 1, total_weight: '9007199254740993', voter_count: 1 },
        ], ['A', 'B']);
        expect(tied.leading).toBeNull();
        expect(tied.tie).toBe(true);
        const empty = pollResultSummary([], ['A', 'B']);
        expect(empty.entries).toEqual([]);
        expect(empty.leading).toBeNull();
        expect(empty.tie).toBe(false);
    });
});

describe('blocksDurationText', () => {
    it('turns a block count into minutes, hours or days at the chain interval', () => {
        expect(blocksDurationText(2, 600)).toBe('20 min');
        expect(blocksDurationText(20, 600)).toBe('3 h');
        expect(blocksDurationText(1008, 600)).toBe('7 days');
        expect(blocksDurationText(144, 600)).toBe('1 day');
        expect(blocksDurationText(null, 600)).toBeNull();
        // 999999999 placeholder close block minus a ~908k tip: absurd day count.
        expect(blocksDurationText(999999999 - 908415, 600)).toBeNull();
        expect(blocksDurationText(365 * 144, 600)).toBe('365 days');
        expect(blocksDurationText(366 * 144 + 144, 600)).toBeNull();
        expect(blocksDurationText(5, null)).toBeNull();
    });
});
