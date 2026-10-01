// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    LIST_TICK_COIN_SEPARATOR,
    LIST_TICK_COINS,
    chainIdForCoin,
    qualifyTickItem,
    splitTickCoinItem,
} from '../../../packages/core/src/shared/utils/listTickCoin.js';
import { classifyTickItems } from '../../../packages/core/src/shared/utils/listTickItems.js';

describe('coin-qualified ticker items', () => {
    it('pins the SDK twin separator and supported coin roots', () => {
        expect(LIST_TICK_COIN_SEPARATOR).toBe(':');
        expect(LIST_TICK_COINS).toEqual(['BTC', 'LTC', 'DOGE']);
    });

    it('splits only supported roots at the first colon and normalizes the coin', () => {
        expect(splitTickCoinItem('doge:^42:tail')).toEqual({ coin: 'DOGE', rest: '^42:tail' });
        expect(splitTickCoinItem('FUTURE:^42')).toBeNull();
        expect(splitTickCoinItem(':PEPE')).toBeNull();
        expect(splitTickCoinItem('PEPE')).toBeNull();
    });

    it('stores own-coin items bare and foreign-coin items qualified', () => {
        expect(qualifyTickItem('btc', '^7', 'BTC')).toBe('^7');
        expect(qualifyTickItem('doge', '^7', 'BTC')).toBe('DOGE:^7');
    });

    it('maps each coin to the descriptor id on the source network', () => {
        expect(chainIdForCoin('BTC', 'dogecoin-mainnet')).toBe('bitcoin-mainnet');
        expect(chainIdForCoin('LTC', 'bitcoin-testnet')).toBe('litecoin-testnet');
        expect(chainIdForCoin('DOGE', 'litecoin-regtest')).toBe('dogecoin-regtest');
        expect(chainIdForCoin('XCH', 'bitcoin-mainnet')).toBeNull();
        expect(chainIdForCoin('BTC', 'bitcoin-signet')).toBeNull();
        expect(chainIdForCoin('BTC', 'custom-mainnet')).toBeNull();
    });

    it('validates qualified rests and folds duplicates by coin and rest', () => {
        expect(classifyTickItems(
            'doge:^42\nDOGE:^42\nBTC:PEPE\nLTC:\nPEPE',
            { coinQualified: true },
        )).toEqual({
            valid: ['doge:^42', 'BTC:PEPE', 'PEPE'],
            invalid: ['LTC:'],
            duplicates: 1,
            coinOf: ['DOGE', 'BTC', null],
        });
    });

    it('keeps the established return shape and whole-item grammar by default', () => {
        expect(classifyTickItems('PEPE\npepe\nDOGE:^42')).toEqual({
            valid: ['PEPE'],
            invalid: ['DOGE:^42'],
            duplicates: 1,
        });
    });

    it('keeps a qualified member distinct from the same bare ticker', () => {
        expect(classifyTickItems('BTC:PEPE\npepe', { coinQualified: true })).toEqual({
            valid: ['BTC:PEPE', 'pepe'],
            invalid: [],
            duplicates: 0,
            coinOf: ['BTC', null],
        });
    });
});
