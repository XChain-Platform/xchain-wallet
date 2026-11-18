// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The oracle record's headline counts markets that opened; the market list
// still carries the rejected creates. Whether the loaded page is complete is a
// question about the list, so it compares against both counts.

import { describe, it, expect } from 'vitest';
import { listedMarketCount, sinceMonthText } from '../../../packages/core/src/shared/routes/oracleRecordSeries.js';

const row = (n, status = 'resolved') => ({ action_index: String(n), feed_status: status, timestamp: 1700000000 + n });

describe('oracle record list completeness with rejected creates', () => {
    it('adds the rejected creates to the headline for the list comparison', () => {
        expect(listedMarketCount({ total_feeds: 3, rejected_feeds: 2 })).toBe(5);
        expect(listedMarketCount({ total_feeds: 3 })).toBe(3);
        expect(listedMarketCount(null)).toBe(0);
    });

    it('does not claim a complete page when a rejected row fills the gap a real market left', () => {
        const record = { total_feeds: 3, rejected_feeds: 2 };
        const rows = [row(1), row(2), row(3, 'invalid'), row(4, 'invalid')];
        expect(sinceMonthText(record, rows)).toBeNull();
    });

    it('names the month once the page holds every listed row', () => {
        const record = { total_feeds: 3, rejected_feeds: 2 };
        const rows = [row(1), row(2), row(3), row(4, 'invalid'), row(5, 'invalid')];
        expect(sinceMonthText(record, rows)).toEqual(expect.any(String));
    });
});
