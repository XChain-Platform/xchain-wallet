// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dust-floor reading for coin-paid dispenser prices. The anchor case is
// the one found live on Dogecoin testnet: action 3048 sells 1 token for
// 0.00001985 DOGE, under DOGE's 0.001 floor, so no buyer could take one fill.

import { describe, it, expect } from 'vitest';
import { dispenserPriceFloor, dispenserFloorBundle } from '../../../packages/core/src/flows/dispenserDustFloor.js';

describe('dispenserPriceFloor', () => {

    it('reads the testnet dispenser as below the DOGE floor, 51 fills minimum', () => {
        const r = dispenserPriceFloor({ coin: 'dogecoin', getAmount: '0.00001985' });
        expect(r.belowFloor).toBe(true);
        expect(r.floor).toBe('0.001');
        // ceil(100000 / 1985) = 51, and 51 * 1985 sats = 101235 sats.
        expect(r.minFills).toBe(51);
        expect(r.minPayment).toBe('0.00101235');
    });

    it('passes a price at exactly the floor as one fill', () => {
        const r = dispenserPriceFloor({ coin: 'dogecoin', getAmount: '0.001' });
        expect(r.belowFloor).toBe(false);
        expect(r.minFills).toBe(1);
    });

    it('uses each chain\'s own floor', () => {
        expect(dispenserPriceFloor({ coin: 'bitcoin', getAmount: '0.00000545' }).belowFloor).toBe(true);
        expect(dispenserPriceFloor({ coin: 'bitcoin', getAmount: '0.00000546' }).belowFloor).toBe(false);
        expect(dispenserPriceFloor({ coin: 'litecoin', getAmount: '0.00005459' }).belowFloor).toBe(true);
    });

    it('refuses to judge what it cannot: unknown coin, empty, zero or malformed price', () => {
        expect(dispenserPriceFloor({ coin: 'solana', getAmount: '0.00001' })).toBe(null);
        expect(dispenserPriceFloor({ coin: 'dogecoin', getAmount: '' })).toBe(null);
        // A zero GET_AMOUNT is a FIAT-priced dispenser, priced at trigger time.
        expect(dispenserPriceFloor({ coin: 'dogecoin', getAmount: '0' })).toBe(null);
        expect(dispenserPriceFloor({ coin: 'dogecoin', getAmount: '1e-5' })).toBe(null);
    });

});

describe('dispenserFloorBundle', () => {

    it('scales both legs by the minimum fills so the unit price is kept', () => {
        expect(dispenserFloorBundle({ coin: 'dogecoin', getAmount: '0.00001985', giveAmount: '1' }))
            .toEqual({ fills: 51, giveAmount: '51', getAmount: '0.00101235' });
    });

    it('multiplies a fractional give amount exactly, past the 8-dp coin grid', () => {
        const b = dispenserFloorBundle({ coin: 'dogecoin', getAmount: '0.00001985', giveAmount: '0.000000000000000001' });
        expect(b.giveAmount).toBe('0.000000000000000051');
        expect(dispenserFloorBundle({ coin: 'dogecoin', getAmount: '0.00001985', giveAmount: '2.5' }).giveAmount)
            .toBe('127.5');
    });

    it('offers nothing when the price already clears the floor or the give amount is unusable', () => {
        expect(dispenserFloorBundle({ coin: 'dogecoin', getAmount: '0.01', giveAmount: '1' })).toBe(null);
        expect(dispenserFloorBundle({ coin: 'dogecoin', getAmount: '0.00001985', giveAmount: '' })).toBe(null);
        expect(dispenserFloorBundle({ coin: 'dogecoin', getAmount: '0.00001985', giveAmount: '0' })).toBe(null);
    });

});
