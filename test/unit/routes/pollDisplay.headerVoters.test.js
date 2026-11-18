// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The poll header's voter total must match the result rows it sits above.
import { describe, expect, it } from 'vitest';
import { headerVoterCount, pollResultSummary } from '../../../packages/core/src/shared/routes/pollDisplay.js';

const tally = pollResultSummary([
    { option_index: 0, total_weight: '987654321', voter_count: 17 },
    { option_index: 1, total_weight: '123456789', voter_count: 4 },
], ['a', 'b']);

describe('headerVoterCount', () => {
    it('sums the result rows when the ballot read lists no ballots', () => {
        expect(headerVoterCount({ finalVoters: null, liveVoters: 0, tally })).toEqual({ voters: 21, ballotsListed: false });
        expect(headerVoterCount({ finalVoters: null, liveVoters: null, tally }).voters).toBe(21);
    });

    it('keeps the frozen count and the ballot read when they exist', () => {
        expect(headerVoterCount({ finalVoters: 20, liveVoters: 0, tally }).voters).toBe(20);
        expect(headerVoterCount({ finalVoters: null, liveVoters: 3, tally })).toEqual({ voters: 3, ballotsListed: true });
    });

    it('reports an empty poll as zero', () => {
        expect(headerVoterCount({ finalVoters: null, liveVoters: 0, tally: pollResultSummary([], []) }).voters).toBe(0);
    });
});
