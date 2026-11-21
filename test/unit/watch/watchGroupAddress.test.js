// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { groupAddress } from '../../../packages/core/src/watch/buildWatchReceive.js';

describe('groupAddress', () => {
    it('trims and groups a bech32 address from the start', () => {
        expect(groupAddress('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080  ')).toBe(
            'bc1q w508 d6qe jxtd g4y5 r3za rvar y0c5 xw7k ygt0 80',
        );
    });

    it('keeps the shorter final group of a legacy address', () => {
        expect(groupAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(
            '1Boa tSLR HtKN ngkd XEeo bR76 b53L ETtp yT',
        );
    });

    it('leaves a four-character input as one group', () => {
        expect(groupAddress('abcd')).toBe('abcd');
    });

    it('returns an empty string for empty and non-string inputs', () => {
        expect(groupAddress('')).toBe('');
        expect(groupAddress('   ')).toBe('');
        expect(groupAddress(null)).toBe('');
    });
});
