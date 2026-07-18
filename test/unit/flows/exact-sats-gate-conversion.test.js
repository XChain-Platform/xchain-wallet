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
import {
    exactSatsFromDecimalString,
    exactSatsBigIntFromDecimalString,
    decimalStringFromSats,
} from '../../../packages/core/src/shared/routes/Send.jsx';

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

// : onMax and onSendSmallTest previously round-tripped through
// parseFloat/toFixed, drifting whole sats on large DOGE balances and
// emitting scientific notation ('1e-8') for one-sat amounts.
describe('exactSatsBigIntFromDecimalString (Max sweep / small-test arithmetic)', () => {
    it('is exact where parseFloat drifts on large balances', () => {
        // 123456789.87654321 DOGE: parseFloat loses low-order sats above 2^53.
        expect(exactSatsBigIntFromDecimalString('123456789.87654321')).toBe(12345678987654321n);
        expect(exactSatsBigIntFromDecimalString('0.29')).toBe(29000000n);
        expect(exactSatsBigIntFromDecimalString('90000000.00000001')).toBe(9000000000000001n);
    });

    it('accepts a bare leading dot like parseFloat did, rejects junk', () => {
        expect(exactSatsBigIntFromDecimalString('.5')).toBe(50000000n);
        expect(exactSatsBigIntFromDecimalString(' 1.000000019 ')).toBe(100000001n);
        expect(exactSatsBigIntFromDecimalString('')).toBe(null);
        expect(exactSatsBigIntFromDecimalString('.')).toBe(null);
        expect(exactSatsBigIntFromDecimalString('1e8')).toBe(null);
        expect(exactSatsBigIntFromDecimalString('-1')).toBe(null);
    });
});

describe('decimalStringFromSats (non-scientific amount formatter)', () => {
    it('never emits scientific notation', () => {
        expect(decimalStringFromSats(1n)).toBe('0.00000001'); // old path gave '1e-8'
        expect(decimalStringFromSats(100000000n)).toBe('1');
        expect(decimalStringFromSats(29000000n)).toBe('0.29');
        expect(decimalStringFromSats(12345678987654321n)).toBe('123456789.87654321');
    });

    it('strips trailing zeros and clamps negatives to zero', () => {
        expect(decimalStringFromSats(150000000n)).toBe('1.5');
        expect(decimalStringFromSats(0n)).toBe('0');
        expect(decimalStringFromSats(-5n)).toBe('0');
    });

    it('round-trips a Max sweep exactly (balance minus fee)', () => {
        const balance = exactSatsBigIntFromDecimalString('123456789.87654321');
        const fee = exactSatsBigIntFromDecimalString('0.00226');
        const display = decimalStringFromSats(balance - fee);
        expect(display).toBe('123456789.87428321');
        expect(exactSatsBigIntFromDecimalString(display)).toBe(balance - fee);
    });
});
