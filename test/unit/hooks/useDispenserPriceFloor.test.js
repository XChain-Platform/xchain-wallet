// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dispenser create form's price notes: which lane refuses, which warns,
// and which says nothing.

import { describe, it, expect } from 'vitest';
import { dispenserPriceNotes } from '../../../packages/core/src/shared/hooks/useDispenserPriceFloor.js';

const BASE = {
    coin: 'dogecoin', coinTicker: 'DOGE', payWith: 'coin', triggerPrice: '', giveAmount: '1',
    fiatCode: '', fiatAmount: '', oracleAddress: '', fiatRate: null,
};

describe('dispenserPriceNotes', () => {

    it('refuses a plain coin price under the floor and offers the bundle', () => {
        const n = dispenserPriceNotes({ ...BASE, triggerPrice: '0.00001985' });
        expect(n.block).toContain('nobody can buy a single fill');
        expect(n.block).toContain('0.001 DOGE');
        expect(n.block).toContain('51 fills (0.00101235 DOGE)');
        expect(n.bundle).toEqual({ fills: 51, giveAmount: '51', getAmount: '0.00101235' });
        expect(n.fiatWarning).toBe(null);
    });

    it('says nothing for a price that clears the floor, or none typed yet', () => {
        expect(dispenserPriceNotes({ ...BASE, triggerPrice: '0.5' }).block).toBe(null);
        expect(dispenserPriceNotes({ ...BASE, triggerPrice: '' }).block).toBe(null);
    });

    it('never refuses the token-paid lane, whose payment is not a coin output', () => {
        expect(dispenserPriceNotes({ ...BASE, payWith: 'token', triggerPrice: '0.00001985' }).block).toBe(null);
    });

    it('does not refuse a fiat or oracle dispenser on its trigger price', () => {
        const fiat = dispenserPriceNotes({ ...BASE, triggerPrice: '0.00001985', fiatCode: 'USD', fiatAmount: '1' });
        expect(fiat.block).toBe(null);
        const oracle = dispenserPriceNotes({ ...BASE, triggerPrice: '0.00001985', oracleAddress: 'nOracle', fiatCode: 'USD' });
        expect(oracle.block).toBe(null);
    });

    it('warns, without refusing, when a fiat price converts under the floor at today\'s rate', () => {
        // $0.0001 at $0.20 per DOGE is 0.0005 DOGE, half the floor.
        const n = dispenserPriceNotes({ ...BASE, fiatCode: 'USD', fiatAmount: '0.0001', fiatRate: { rate: 0.2 } });
        expect(n.block).toBe(null);
        expect(n.fiatWarning).toContain('0.0005 DOGE');
        expect(n.fiatWarning).toContain('2 fills at a time');
    });

    it('stays quiet on a fiat price with no rate or one that clears the floor', () => {
        expect(dispenserPriceNotes({ ...BASE, fiatCode: 'USD', fiatAmount: '0.0001' }).fiatWarning).toBe(null);
        expect(dispenserPriceNotes({ ...BASE, fiatCode: 'USD', fiatAmount: '1', fiatRate: { rate: 0.2 } }).fiatWarning)
            .toBe(null);
    });

});
