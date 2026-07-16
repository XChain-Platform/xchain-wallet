// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// #2249: the send-risk gates (testSendGate threshold, classifySignRisk HW
// cross-check) derived satoshis via Math.floor(parseFloat(x) * 1e8), which
// accumulates IEEE-754 rounding error and biases downward, so an amount at
// a decimal boundary could land one satoshi off and mis-gate. The exact
// string/BigInt converter must agree with the decimal string the submitted
// transaction actually carries.

import { describe, it, expect } from 'vitest';
import { exactSatsFromDecimalString } from '../../../packages/core/src/shared/routes/Send.jsx';

describe('exactSatsFromDecimalString (send-risk gate conversion)', () => {
    it('converts decimal-boundary values exactly where float math drifts', () => {
        // Classic float trap: parseFloat('0.29') * 1e8 = 28999999.999999996,
        // Math.floor -> 28999999 (one sat low). Exact math must say 29000000.
        expect(Math.floor(parseFloat('0.29') * 1e8)).toBe(28999999); // documents the old bug
        expect(exactSatsFromDecimalString('0.29')).toBe(29000000);
        expect(exactSatsFromDecimalString('123.45678901')).toBe(12345678901);
        expect(exactSatsFromDecimalString('0.00000001')).toBe(1);
        expect(exactSatsFromDecimalString('21000000')).toBe(2100000000000000);
    });

    it('truncates beyond 8 decimals and tolerates whitespace', () => {
        expect(exactSatsFromDecimalString(' 1.000000019 ')).toBe(100000001);
        expect(exactSatsFromDecimalString('1.')).toBe(null); // not a plain decimal
    });

    it('rejects non-plain-decimal input the way the gates treat unusable amounts', () => {
        expect(exactSatsFromDecimalString('')).toBe(null);
        expect(exactSatsFromDecimalString('1e8')).toBe(null);
        expect(exactSatsFromDecimalString('-1')).toBe(null);
        expect(exactSatsFromDecimalString('abc')).toBe(null);
        expect(exactSatsFromDecimalString('0x10')).toBe(null);
    });

    it('clamps absurd magnitudes instead of silently losing precision', () => {
        expect(exactSatsFromDecimalString('99999999999999999999')).toBe(Number.MAX_SAFE_INTEGER);
    });
});
