// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: balanceAdapter. SDK balance shape -> txSimulator BalanceLookup[].

import { describe, it, expect } from 'vitest';
import { balancesFromSdk } from '../../../packages/core/src/decoder/balanceAdapter.js';

describe('balancesFromSdk', () => {
    describe('null / invalid inputs', () => {
        it('returns [] for null', () => {
            expect(balancesFromSdk(null)).toEqual([]);
        });

        it('returns [] for undefined', () => {
            expect(balancesFromSdk(undefined)).toEqual([]);
        });

        it('returns [] for a non-object', () => {
            expect(balancesFromSdk('string')).toEqual([]);
            expect(balancesFromSdk(42)).toEqual([]);
        });

        it('returns [] for an empty object', () => {
            expect(balancesFromSdk({})).toEqual([]);
        });
    });

    describe('native coin row', () => {
        it('converts a native BTC row with divisibility 8', () => {
            const out = balancesFromSdk({
                native: { tick: 'BTC', divisibility: 8, quantity: '5000000' },
                tokens: [],
            });
            expect(out).toHaveLength(1);
            expect(out[0]).toMatchObject({ tick: 'BTC', amount: '0.05', isCoin: true });
        });

        it('uppercases the native tick', () => {
            const out = balancesFromSdk({ native: { tick: 'btc', divisibility: 8, quantity: '100000000' } });
            expect(out[0].tick).toBe('BTC');
        });

        it('handles zero quantity', () => {
            const out = balancesFromSdk({ native: { tick: 'BTC', divisibility: 8, quantity: '0' } });
            expect(out[0].amount).toBe('0');
        });

        it('skips native row when tick is empty', () => {
            const out = balancesFromSdk({ native: { tick: '', divisibility: 8, quantity: '100' } });
            expect(out).toHaveLength(0);
        });

        it('handles null native gracefully', () => {
            const out = balancesFromSdk({ native: null, tokens: [] });
            expect(out).toHaveLength(0);
        });

        it('handles divisibility 0 (indivisible coin)', () => {
            const out = balancesFromSdk({ native: { tick: 'DOGE', divisibility: 0, quantity: '1234' } });
            expect(out[0].amount).toBe('1234');
        });
    });

    describe('token rows', () => {
        it('converts multiple token rows', () => {
            const out = balancesFromSdk({
                tokens: [
                    { tick: 'XCP', divisibility: 8, quantity: '100000000' },
                    { tick: 'FILE', divisibility: 0, quantity: '50' },
                ],
            });
            expect(out).toHaveLength(2);
            expect(out[0]).toMatchObject({ tick: 'XCP', amount: '1', isCoin: false });
            expect(out[1]).toMatchObject({ tick: 'FILE', amount: '50', isCoin: false });
        });

        it('skips token rows with an empty tick', () => {
            const out = balancesFromSdk({
                tokens: [
                    { tick: '', divisibility: 8, quantity: '100' },
                    { tick: 'GOOD', divisibility: 0, quantity: '1' },
                ],
            });
            expect(out).toHaveLength(1);
            expect(out[0].tick).toBe('GOOD');
        });

        it('skips null / non-object rows', () => {
            const out = balancesFromSdk({
                tokens: [null, undefined, { tick: 'TOKEN', divisibility: 0, quantity: '7' }],
            });
            expect(out).toHaveLength(1);
        });

        it('handles tokens: undefined gracefully', () => {
            const out = balancesFromSdk({ native: { tick: 'BTC', divisibility: 8, quantity: '1' } });
            // Only the native row; no error on missing tokens.
            expect(out).toHaveLength(1);
        });
    });

    describe('scaleDown edge cases', () => {
        it('1 satoshi = 0.00000001 BTC', () => {
            const out = balancesFromSdk({ native: { tick: 'BTC', divisibility: 8, quantity: '1' } });
            expect(out[0].amount).toBe('0.00000001');
        });

        it('100 units at divisibility 2 = 1', () => {
            const out = balancesFromSdk({ tokens: [{ tick: 'T', divisibility: 2, quantity: '100' }] });
            expect(out[0].amount).toBe('1');
        });

        it('already-decimal quantity passes through verbatim', () => {
            const out = balancesFromSdk({ tokens: [{ tick: 'T', divisibility: 8, quantity: '1.5' }] });
            expect(out[0].amount).toBe('1.5');
        });

        it('null quantity becomes 0', () => {
            const out = balancesFromSdk({ tokens: [{ tick: 'T', divisibility: 8, quantity: null }] });
            expect(out[0].amount).toBe('0');
        });

        it('undefined quantity becomes 0', () => {
            const out = balancesFromSdk({ tokens: [{ tick: 'T', divisibility: 8, quantity: undefined }] });
            expect(out[0].amount).toBe('0');
        });

        it('divisibility given as a string is coerced', () => {
            const out = balancesFromSdk({ tokens: [{ tick: 'T', divisibility: '8', quantity: '100000000' }] });
            expect(out[0].amount).toBe('1');
        });
    });
});
