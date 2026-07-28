// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fuzz: formatAmount output invariants.
//
// The subject is the SHIPPED formatAmount, imported from BalanceList. This
// harness used to carry its own copy, which had drifted: the copy stripped
// trailing fractional zeros, while the shipped formatter deliberately keeps
// them (0.04210000 BTC reads as 0.04210000). Importing the real one is the
// only way these properties say anything about the wallet.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatAmount } from '../../../packages/core/src/shared/components/BalanceList.jsx';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 100);

// fast-check 4 dropped the fixed-width bigint arbitraries (bigUintN/bigIntN)
// in favour of range constraints on bigInt. This is the 64-bit unsigned range
// the harness was written against.
const uint64 = () => fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });
const divisibility = () => fc.integer({ min: 0, max: 18 });

describe('fuzz/format-amount', () => {
    it('always returns a string', () => {
        fc.assert(
            fc.property(fc.bigInt(), divisibility(), (q, d) => {
                return typeof formatAmount(String(q), d) === 'string';
            }),
            { numRuns: RUNS },
        );
    });

    it('integer part has no leading zeros (except for 0 itself)', () => {
        // Counted so the property cannot pass purely on the intPart === '0'
        // escape hatch; a run that never produced a multi-digit integer part
        // would have proved nothing.
        let nonZeroIntParts = 0;
        fc.assert(
            fc.property(uint64(), divisibility(), (q, d) => {
                const out = formatAmount(String(q), d);
                const intPart = out.split('.')[0].replaceAll(',', '');
                if (intPart === '0') return true;
                nonZeroIntParts += 1;
                return !intPart.startsWith('0');
            }),
            { numRuns: RUNS },
        );
        expect(nonZeroIntParts).toBeGreaterThan(0);
    });

    it('fractional part is present and exactly `divisibility` digits wide', () => {
        // Trailing zeros are KEPT by design, so the invariant is a fixed-width
        // fraction rather than a stripped one.
        let withFraction = 0;
        fc.assert(
            fc.property(uint64(), divisibility(), (q, d) => {
                const out = formatAmount(String(q), d);
                const dot = out.indexOf('.');
                if (d <= 0) return dot < 0;
                if (dot < 0) return false;
                withFraction += 1;
                return out.slice(dot + 1).length === d && /^\d+$/.test(out.slice(dot + 1));
            }),
            { numRuns: RUNS },
        );
        expect(withFraction).toBeGreaterThan(0);
    });

    it('thousand separators only appear in groups of 3 in the integer part', () => {
        let separated = 0;
        fc.assert(
            fc.property(uint64(), divisibility(), (q, d) => {
                const out = formatAmount(String(q), d);
                const intPart = out.split('.')[0];
                const groups = intPart.split(',');
                if (groups.length === 1) return true;
                separated += 1;
                // Leading group is 1-3 digits; every later group is exactly 3.
                return (
                    groups[0].length >= 1 &&
                    groups[0].length <= 3 &&
                    groups.slice(1).every((g) => g.length === 3)
                );
            }),
            { numRuns: RUNS },
        );
        expect(separated).toBeGreaterThan(0);
    });

    it('the fractional digits are the low `divisibility` digits of the input', () => {
        // Round-trip check: reassembling the rendered digits must give back the
        // integer that went in. Guards against a formatter that emits a
        // well-shaped but wrong number.
        fc.assert(
            fc.property(uint64(), divisibility(), (q, d) => {
                const out = formatAmount(String(q), d);
                const digits = out.replaceAll(',', '').replace('.', '');
                return BigInt(digits) === q;
            }),
            { numRuns: RUNS },
        );
    });
});
