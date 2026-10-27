// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A market row with a figure that is not a number shows no figure, never
// "NaN", "[object Object]" or a percentage read out of an overflowing exponent.

import { describe, it, expect } from 'vitest';
import { normalizeMarket } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

const base = { tick1: 'BTC', tick2: 'TOKEN' };

describe('normalizeMarket with malformed figures', () => {
    it.each([['NaN'], [{}], [['1']], [true], ['Infinity'], ['']])(
        'drops the last price %j', (price) => {
            expect(normalizeMarket({ ...base, last_price: price }).lastPrice).toBeUndefined();
        },
    );

    it('drops an overflowing change figure and keeps a real one', () => {
        expect(normalizeMarket({ ...base, tick1_24hr_change: '1e999%' }).change24h).toBeUndefined();
        expect(normalizeMarket({ ...base, tick1_24hr_change: '-5.25%' }).change24h).toBe('-5.25%');
        expect(normalizeMarket({ ...base, change_24h: 3 }).change24h).toBe('3');
    });

    it('keeps a plain price and an exponent price a number type serialises to', () => {
        expect(normalizeMarket({ ...base, last_price: '0.00012' }).lastPrice).toBe('0.00012');
        expect(normalizeMarket({ ...base, last_price: 1e-7 }).lastPrice).toBe('1e-7');
    });

    it('drops a negative depth and a non-string ticker', () => {
        expect(normalizeMarket({ ...base, depth: -1 }).depth).toBeUndefined();
        expect(normalizeMarket({ tick1: {}, tick2: 'X' })).toBeNull();
    });
});
