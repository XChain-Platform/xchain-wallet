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
import {
    dispensesOfDispenser,
    dispenseIsValid,
    dispenseInvalidReason,
    vendedTotal,
} from '../../../packages/core/src/flows/dispenserQueries.js';

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
        expect(rows).toEqual([{ ...tokenPaidFill, valid: true }]);
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
        expect(rows).toEqual([{ ...tokenPaidFill, valid: true }]);
    });

    it('falls back to ticks for rows from an explorer with no dispenser lane', () => {
        // Legacy row: no dispenser_action_index. Better to over-report than to
        // show a dispenser with a blank history.
        const legacy = { action_index: '900', give_tick: 'XCHAIN', get_tick: 'MEMEVALID' };
        expect(dispensesOfDispenser([legacy], '3543', tokenPaidDispenser)).toEqual([{ ...legacy, valid: true }]);
        expect(dispensesOfDispenser([legacy], '3543', { give_tick: 'OTHER', get_tick: 'MEMEVALID' }))
            .toEqual([]);
    });

    it('returns an empty list for a missing or non-array response', () => {
        expect(dispensesOfDispenser(undefined, '3543', tokenPaidDispenser)).toEqual([]);
        expect(dispensesOfDispenser(null, '3543', tokenPaidDispenser)).toEqual([]);
        expect(dispensesOfDispenser({ data: [] }, '3543', tokenPaidDispenser)).toEqual([]);
    });
});

// A refused dispense reaches the wallet as a normal row with its attempted
// give_amount intact and `status: "invalid: <reason>"`. Observed live on
// Dogecoin testnet: a 500-token attempt refused because the payer was the
// pay-to address rendered as a 500-token sale. The tag below is the ONE
// place that decides what a row counts for.
describe('dispensesOfDispenser: valid tag', () => {
    const refused = {
        action_index: '819',
        dispenser_action_index: '816',
        give_tick: 'DOGESWAP',
        give_amount: '500',
        get_coin: 'DOGE',
        get_amount: '450.02310427',
        status: 'invalid: SOURCE and GET_ADDRESS can not be same',
    };
    const honoured = { ...refused, action_index: '820', give_amount: '100', get_amount: '2.00000000', status: 'valid' };
    const dispenser = { give_tick: 'DOGESWAP', get_tick: null };

    it('keeps a refused row in the list, tagged invalid, with the honoured one tagged valid', () => {
        const rows = dispensesOfDispenser([honoured, refused], '816', dispenser);
        expect(rows.map((r) => [r.action_index, r.valid])).toEqual([['820', true], ['819', false]]);
    });

    it('treats a row with no status column as valid (an explorer that predates it)', () => {
        const { status, ...bare } = honoured;
        expect(dispensesOfDispenser([bare], '816', dispenser)[0].valid).toBe(true);
        expect(dispenseIsValid({})).toBe(true);
        expect(dispenseIsValid({ status: null })).toBe(true);
    });

    it('reads any non-valid status as refused, whatever its case or spacing', () => {
        expect(dispenseIsValid({ status: 'valid' })).toBe(true);
        expect(dispenseIsValid({ status: ' Valid ' })).toBe(true);
        expect(dispenseIsValid({ status: 'invalid' })).toBe(false);
        expect(dispenseIsValid({ status: 'INVALID: x' })).toBe(false);
    });

    it('extracts the reason without the invalid prefix', () => {
        expect(dispenseInvalidReason(refused)).toBe('SOURCE and GET_ADDRESS can not be same');
        expect(dispenseInvalidReason({ status: 'invalid' })).toBe('');
        expect(dispenseInvalidReason(honoured)).toBe('');
    });
});

describe('vendedTotal', () => {
    it('sums only the rows that dispensed', () => {
        expect(vendedTotal([
            { valid: true, give_amount: '100' },
            { valid: false, give_amount: '500' },
            { valid: true, give_amount: '25' },
        ])).toBe('125');
    });

    it('is null when nothing dispensed', () => {
        expect(vendedTotal([{ valid: false, give_amount: '500' }])).toBeNull();
        expect(vendedTotal([])).toBeNull();
        expect(vendedTotal(undefined)).toBeNull();
    });

    it('adds decimals exactly', () => {
        expect(vendedTotal([
            { valid: true, give_amount: '0.1' },
            { valid: true, give_amount: '0.2' },
        ])).toBe('0.3');
        expect(vendedTotal([
            { valid: true, give_amount: '1.50' },
            { valid: true, give_amount: '0.005' },
        ])).toBe('1.505');
    });

    it('skips rows whose amount is not a plain decimal', () => {
        expect(vendedTotal([{ valid: true, give_amount: null }, { valid: true, give_amount: '7' }])).toBe('7');
    });
});
