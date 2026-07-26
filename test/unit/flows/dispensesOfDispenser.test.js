// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: D-38. DispenserDetail's "Dispenses" tab was listing fills that
// belonged to OTHER dispensers, because it matched on ticks with an `||`
// fallback: a coin-paid fill carries get_tick NULL, so
// `String(d.get_tick || dispenser.get_tick) === dispenser.get_tick` was
// true for every dispenser. Observed live on regtest, where a token-paid
// dispenser that had never dispensed showed seven of its neighbours' fills.
// The honest key is the dispense row's dispenser_action_index.

import { describe, it, expect } from 'vitest';
import { dispensesOfDispenser } from '../../../packages/core/src/flows/dispenserQueries.js';

// A coin-paid fill (get_tick NULL) and a token-paid fill, both on the same
// source address, belonging to two different dispensers - the exact live shape.
const coinPaidFill = {
    action_index: '3542',
    dispenser_action_index: '3442',
    give_tick: 'XCHAIN',
    give_amount: '100',
    get_tick: null,
    get_coin: 'BTC',
    get_amount: '0.00500000',
};
const tokenPaidFill = {
    action_index: '3600',
    dispenser_action_index: '3543',
    give_tick: 'XCHAIN',
    give_amount: '25',
    get_tick: 'MEMEVALID',
    get_amount: '5',
};

const tokenPaidDispenser = { give_tick: 'XCHAIN', get_tick: 'MEMEVALID' };
const coinPaidDispenser = { give_tick: 'XCHAIN', get_tick: null };

describe('dispensesOfDispenser', () => {
    it('keeps only the fills naming this dispenser', () => {
        const rows = dispensesOfDispenser([coinPaidFill, tokenPaidFill], '3543', tokenPaidDispenser);
        expect(rows).toEqual([tokenPaidFill]);
    });

    it('does not leak a coin-paid fill (get_tick NULL) into another dispenser', () => {
        // The pre-fix filter matched this row for ANY dispenser.
        const rows = dispensesOfDispenser([coinPaidFill], '3543', tokenPaidDispenser);
        expect(rows).toEqual([]);
    });

    it('separates two dispensers that vend the SAME pair from one address', () => {
        const twin = { ...coinPaidFill, action_index: '3700', dispenser_action_index: '3508' };
        const rows = dispensesOfDispenser([coinPaidFill, twin], '3508', coinPaidDispenser);
        expect(rows.map((r) => r.action_index)).toEqual(['3700']);
    });

    it('compares the key as a string, so a numeric actionIndex still matches', () => {
        const rows = dispensesOfDispenser([tokenPaidFill], 3543, tokenPaidDispenser);
        expect(rows).toEqual([tokenPaidFill]);
    });

    it('falls back to ticks for rows from an explorer with no dispenser lane', () => {
        // Legacy row: no dispenser_action_index. Better to over-report than to
        // show a dispenser with a blank history.
        const legacy = { action_index: '900', give_tick: 'XCHAIN', get_tick: 'MEMEVALID' };
        expect(dispensesOfDispenser([legacy], '3543', tokenPaidDispenser)).toEqual([legacy]);
        expect(dispensesOfDispenser([legacy], '3543', { give_tick: 'OTHER', get_tick: 'MEMEVALID' }))
            .toEqual([]);
    });

    it('returns an empty list for a missing or non-array response', () => {
        expect(dispensesOfDispenser(undefined, '3543', tokenPaidDispenser)).toEqual([]);
        expect(dispensesOfDispenser(null, '3543', tokenPaidDispenser)).toEqual([]);
        expect(dispensesOfDispenser({ data: [] }, '3543', tokenPaidDispenser)).toEqual([]);
    });
});
