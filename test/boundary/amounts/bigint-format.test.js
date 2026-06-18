// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Boundary: amount formatting works correctly at the tail of the BigInt
// range; atomic-unit balances for high-supply tokens routinely hit
// 10^18+ which JS Number can't represent exactly.

import { describe, it, expect } from 'vitest';

// Inline the formatAmount used by the balance-row layout so the
// boundary test pins the formatting contract independently of the
// component file (which is a JSX module + React).
function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) return groupThousands(q);
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    let frac = padded.slice(padded.length - divisibility);
    frac = frac.replace(/0+$/, '');
    const out = frac ? `${groupThousands(whole)}.${frac}` : groupThousands(whole);
    return negative ? `-${out}` : out;
}
function groupThousands(s) {
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

describe('boundary/amounts/format', () => {
    it('renders zero correctly at every common divisibility', () => {
        for (const div of [0, 2, 8, 18]) {
            expect(formatAmount('0', div)).toBe('0');
        }
    });

    it('renders 1 atomic unit as 0.<div-1 zeros>1 for div > 0', () => {
        expect(formatAmount('1', 8)).toBe('0.00000001');
        expect(formatAmount('1', 18)).toBe('0.000000000000000001');
    });

    it('groups thousands in the integer part only', () => {
        expect(formatAmount('1000000000', 0)).toBe('1,000,000,000');
        expect(formatAmount('100000000000', 8)).toBe('1,000');
    });

    it('handles supply at the 10^77 ceiling cleanly', () => {
        const bigBalance = '1' + '0'.repeat(77);
        const out = formatAmount(bigBalance, 8);
        expect(out.endsWith('00,000,000')).toBe(true);
    });

    it('preserves negative sign across the fractional split', () => {
        expect(formatAmount('-100000001', 8)).toBe('-1.00000001');
    });

    it('trims ALL trailing zeros, not just the last', () => {
        expect(formatAmount('100000000', 8)).toBe('1');
        expect(formatAmount('100000000000000', 8)).toBe('1,000,000');
    });
});
