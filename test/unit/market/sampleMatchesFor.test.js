// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sampleMatchesFor reads Date.now(), so the clock is pinned to make the
// timestamp window and the determinism claim exact.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sampleMatchesFor } from '../../../packages/core/src/market/sampleMarketData.js';

const FIXED_NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0);
const NOW_SEC = FIXED_NOW_MS / 1000;
const MAX_AGE_SEC = 7 * 86400 + 1800;

describe('market/sampleMarketData sampleMatchesFor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_NOW_MS);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns 80 rows', () => {
        expect(sampleMatchesFor('AAA', 'BBB')).toHaveLength(80);
    });

    it('gives every row its six fields', () => {
        for (const row of sampleMatchesFor('AAA', 'BBB')) {
            for (const key of ['give_tick', 'get_tick', 'give_amount', 'get_amount', 'timestamp', 'destination']) {
                expect(row[key]).toBeDefined();
            }
        }
    });

    it('orients each row as (tick2 give, tick1 get) or (tick1 give, tick2 get)', () => {
        const rows = sampleMatchesFor('AAA', 'BBB');
        for (const row of rows) {
            const pair = [row.give_tick, row.get_tick].join('>');
            expect(['BBB>AAA', 'AAA>BBB']).toContain(pair);
        }
        const pairs = new Set(rows.map((r) => `${r.give_tick}>${r.get_tick}`));
        expect(pairs.size).toBe(2);
    });

    it('keeps integer timestamps inside the 7 day plus 1800 second window', () => {
        for (const { timestamp } of sampleMatchesFor('AAA', 'BBB')) {
            expect(Number.isInteger(timestamp)).toBe(true);
            expect(timestamp).toBeLessThanOrEqual(NOW_SEC);
            expect(timestamp).toBeGreaterThanOrEqual(NOW_SEC - MAX_AGE_SEC);
        }
    });

    it('is deterministic for the same pair at the same fixed time', () => {
        expect(sampleMatchesFor('AAA', 'BBB')).toEqual(sampleMatchesFor('AAA', 'BBB'));
    });
});
