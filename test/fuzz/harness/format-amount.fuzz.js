// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Fuzz: formatAmount output invariants.

import { describe, it } from 'vitest';
import fc from 'fast-check';

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

const RUNS = Number(process.env.FUZZ_ITERATIONS || 100);

describe('fuzz/format-amount', () => {
    it('always returns a string', () => {
        fc.assert(
            fc.property(fc.bigInt(), fc.integer({ min: 0, max: 18 }), (q, d) => {
                return typeof formatAmount(String(q), d) === 'string';
            }),
            { numRuns: RUNS },
        );
    });

    it('integer part has no leading zeros (except for 0 itself)', () => {
        fc.assert(
            fc.property(fc.bigUintN(64), fc.integer({ min: 0, max: 18 }), (q, d) => {
                const out = formatAmount(String(q), d);
                const intPart = out.split('.')[0].replaceAll(',', '');
                if (intPart === '0') return true;
                return !intPart.startsWith('0');
            }),
            { numRuns: RUNS },
        );
    });

    it('fractional part (if present) has no trailing zero', () => {
        fc.assert(
            fc.property(fc.bigUintN(64), fc.integer({ min: 0, max: 18 }), (q, d) => {
                const out = formatAmount(String(q), d);
                const dot = out.indexOf('.');
                if (dot < 0) return true;
                return !out.endsWith('0');
            }),
            { numRuns: RUNS },
        );
    });

    it('thousand separators only appear in groups of 3 in the integer part', () => {
        fc.assert(
            fc.property(fc.bigUintN(64), fc.integer({ min: 0, max: 18 }), (q, d) => {
                const out = formatAmount(String(q), d);
                const intPart = out.split('.')[0];
                const groups = intPart.split(',');
                if (groups.length === 1) return true;
                return groups.slice(1).every((g) => g.length === 3);
            }),
            { numRuns: RUNS },
        );
    });
});
