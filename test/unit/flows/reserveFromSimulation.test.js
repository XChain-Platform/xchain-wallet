// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (§4.7): derive what an action spends, so a second approval
// window can be told about it.
//
// Two properties matter more than the happy path:
//   1. the subtraction is EXACT at any precision (§4.5 rule 1: native JS
//      numbers WILL produce false verdicts, and this gates a reservation);
//   2. an action this cannot express as ONE reservation reserves NOTHING.
//      Reserving one leg of a multi-tick spend would leave the UI implying
//      full protection while silently covering half of it.

import { describe, it, expect } from 'vitest';
import { reserveFromSimulation } from '../../../packages/core/src/flows/reserveFromSimulation.js';
import { subtractAmounts } from '../../../packages/core/src/market/orderMath.js';

const D = (tick, before, after, extra = {}) => ({ tick, before, after, ...extra });

describe('subtractAmounts (exact decimal)', () => {
    it('subtracts across differing scales exactly', () => {
        // The float answer here is 0.9999999900000001.
        expect(subtractAmounts('1', '0.00000001')).toBe('0.99999999');
        expect(subtractAmounts('0.3', '0.1')).toBe('0.2');
        expect(subtractAmounts('10', '2.5')).toBe('7.5');
    });

    it('holds precision well beyond a float', () => {
        expect(subtractAmounts('100000000.00000001', '100000000')).toBe('0.00000001');
        expect(subtractAmounts('9007199254740993', '1')).toBe('9007199254740992');
    });

    it('trims trailing zeros without mangling the integer part', () => {
        expect(subtractAmounts('1.50', '0.50')).toBe('1');
        expect(subtractAmounts('2.100', '0.100')).toBe('2');
    });

    it('returns null for a credit, a no-op, or junk', () => {
        expect(subtractAmounts('1', '2')).toBe(null);      // credit
        expect(subtractAmounts('1', '1')).toBe(null);      // no change
        expect(subtractAmounts('1e-7', '0')).toBe(null);   // scientific notation
        expect(subtractAmounts('abc', '1')).toBe(null);
        expect(subtractAmounts('', '1')).toBe(null);
        expect(subtractAmounts(null, '1')).toBe(null);
    });
});

describe('reserveFromSimulation', () => {
    it('returns the single debited token with its exact amount', () => {
        expect(reserveFromSimulation({
            deltas: [D('JDOG', '10', '7.5')],
        })).toEqual({ tick: 'JDOG', amount: '2.5' });
    });

    it('ignores the native coin and the fee row', () => {
        // A SEND debits the token AND the coin (for the miner fee). Only the
        // token is the balance a concurrent token spend races on.
        expect(reserveFromSimulation({
            deltas: [
                D('BTC', '1', '0.9999', { isCoin: true }),
                D('BTC', '1', '0.9999', { isFee: true, feeAmount: '0.0001' }),
                D('JDOG', '100', '40'),
            ],
        })).toEqual({ tick: 'JDOG', amount: '60' });
    });

    it('reserves NOTHING when two ticks are debited', () => {
        // One reservation cannot express a two-tick spend, and half-protection
        // that looks like full protection is worse than none.
        expect(reserveFromSimulation({
            deltas: [D('JDOG', '10', '5'), D('PEPE', '8', '1')],
        })).toBe(null);
    });

    it('reserves nothing when no token is debited', () => {
        expect(reserveFromSimulation({ deltas: [D('JDOG', '10', '10')] })).toBe(null);
        expect(reserveFromSimulation({ deltas: [D('JDOG', '10', '12')] })).toBe(null);
        expect(reserveFromSimulation({ deltas: [] })).toBe(null);
    });

    it('tolerates a missing or malformed simulation', () => {
        expect(reserveFromSimulation(null)).toBe(null);
        expect(reserveFromSimulation(undefined)).toBe(null);
        expect(reserveFromSimulation({})).toBe(null);
        expect(reserveFromSimulation({ deltas: [null, { tick: '' }] })).toBe(null);
    });
});
