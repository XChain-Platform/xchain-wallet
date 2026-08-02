// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the real on-chain size ( §8, ).
//
// This renders on a SUCCESS screen, after the user's money is already spent, so
// the failure that matters is not an exception: it is confidently showing a
// number that is wrong. Hence the rule the tests enforce throughout: when the
// report is missing, partial or malformed, say NOTHING rather than guess.

import { describe, it, expect } from 'vitest';
import { storedSizeSummary, storedSizeLine } from '../../../packages/core/src/flows/storedSizeSummary.js';

describe('storedSizeSummary', () => {
    it('reports the real numbers for a compressed payload', () => {
        // the testnet4 proof: 5,200 bytes stored as 133
        const s = storedSizeSummary({ compressed: true, rawLength: 5200, storedLength: 133 });
        expect(s.storedBytes).toBe(133);
        expect(s.originalBytes).toBe(5200);
        expect(s.compressed).toBe(true);
        expect(s.savedBytes).toBe(5067);
        expect(s.ratio).toBeCloseTo(39.1, 1);
        expect(Math.round(s.savedPercent)).toBe(97);
    });

    it('an incompressible payload reports stored === original, not a saving', () => {
        const s = storedSizeSummary({ compressed: false, rawLength: 4000, storedLength: 4000 });
        expect(s.compressed).toBe(false);
        expect(s.savedBytes).toBe(0);
        expect(s.ratio).toBe(1);
    });

    it('uses the caller\'s known file size when the report omits rawLength', () => {
        const s = storedSizeSummary({ compressed: true, storedLength: 100 }, 1000);
        expect(s.originalBytes).toBe(1000);
        expect(s.storedBytes).toBe(100);
    });

    it('SAYS NOTHING when there is nothing trustworthy to say', () => {
        // no report at all, and no fallback: guessing here would be inventing a number
        expect(storedSizeSummary(null)).toBeNull();
        expect(storedSizeSummary(undefined)).toBeNull();
        expect(storedSizeSummary({}, undefined)).toBeNull();
        // compressed with no stored length: the one case we must NOT fill in,
        // because the stored size is precisely what is unknown
        expect(storedSizeSummary({ compressed: true, rawLength: 900 })).toBeNull();
    });

    it('an UNcompressed report with no stored length is safe to fill in', () => {
        // nothing was compressed, so stored and original are the same number
        const s = storedSizeSummary({ compressed: false, rawLength: 900 });
        expect(s.storedBytes).toBe(900);
        expect(s.originalBytes).toBe(900);
    });

    it('never throws and never emits Infinity or NaN on malformed input', () => {
        for (const bad of ['x', 42, [], true, { rawLength: 'many', storedLength: {} },
                           { compressed: true, rawLength: -1, storedLength: -5 }]) {
            const s = storedSizeSummary(bad, 100);
            if (s) {
                expect(Number.isFinite(s.storedBytes)).toBe(true);
                expect(Number.isFinite(s.originalBytes)).toBe(true);
                expect(s.ratio === null || Number.isFinite(s.ratio)).toBe(true);
            }
        }
    });

    it('guards the zero-stored division rather than reporting Infinity', () => {
        const s = storedSizeSummary({ compressed: true, rawLength: 100, storedLength: 0 });
        expect(s.ratio).toBeNull();
    });
});

describe('storedSizeLine', () => {
    it('leads with the stored size, which is the number the user is paying for', () => {
        const line = storedSizeLine(storedSizeSummary({ compressed: true, rawLength: 5200, storedLength: 133 }));
        expect(line).toMatch(/^Stored on-chain: 133 bytes/);
        expect(line).toContain('5,200');
        expect(line).toContain('97% smaller');
    });

    it('does not claim a saving for an incompressible file', () => {
        const line = storedSizeLine(storedSizeSummary({ compressed: false, rawLength: 4000, storedLength: 4000 }));
        expect(line).toContain('4,000');
        expect(line).not.toMatch(/smaller|compressed from/);
    });

    it('renders nothing when there is nothing to say', () => {
        expect(storedSizeLine(null)).toBeNull();
        expect(storedSizeLine(storedSizeSummary(null))).toBeNull();
    });
});
