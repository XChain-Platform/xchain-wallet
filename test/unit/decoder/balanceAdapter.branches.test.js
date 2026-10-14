// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { balancesFromSdk } from '../../../packages/core/src/decoder/balanceAdapter.js';

describe('balancesFromSdk edge branches', () => {
    it('emits an unknown coin marker when the native lookup is unavailable', () => {
        expect(balancesFromSdk({ unavailable: ['native'], tokens: [] })).toEqual([
            { tick: '', amount: '', isCoin: true, unknown: true },
        ]);
    });

    it('uses a supplied native row even when unavailable metadata is present', () => {
        expect(balancesFromSdk({
            unavailable: ['native'],
            native: { tick: 'btc', quantity: '25000000', divisibility: 8 },
        })).toEqual([
            { tick: 'BTC', amount: '0.25', isCoin: true },
        ]);
    });

    it.each([-1, 1.5, 19])('marks divisibility %s as unknown', (divisibility) => {
        expect(balancesFromSdk({
            tokens: [{ tick: 'EDGE', quantity: '1', divisibility }],
        })).toEqual([
            { tick: 'EDGE', amount: '', isCoin: false, unknown: true },
        ]);
    });

    it('marks malformed numeric text as unknown', () => {
        expect(balancesFromSdk({
            tokens: [{ tick: 'EDGE', quantity: '1e8', divisibility: 8 }],
        })[0]).toEqual({ tick: 'EDGE', amount: '', isCoin: false, unknown: true });
    });

    it('scales negative base units without losing the sign', () => {
        expect(balancesFromSdk({
            tokens: [{ tick: 'EDGE', quantity: '-123', divisibility: 2 }],
        })[0].amount).toBe('-1.23');
    });

    it('ignores a non-array token collection', () => {
        expect(balancesFromSdk({ tokens: { tick: 'EDGE', quantity: '1' } })).toEqual([]);
    });
});
