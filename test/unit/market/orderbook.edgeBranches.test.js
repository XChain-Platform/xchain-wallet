// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizeOrderbook } from '../../../packages/core/src/market/orderbook.js';

describe('market/orderbook edge branches', () => {
    it('unwraps a direct array response and preserves equal-price level order', () => {
        const book = normalizeOrderbook([{
            bids: [['2', '1'], ['2.0', '2']],
            asks: [['3', '4']],
        }]);

        expect(book.bids.map(({ price, cumulative }) => [price, cumulative])).toEqual([
            ['2', '1'],
            ['2.0', '3'],
        ]);
        expect(book.maxCumulative).toBe('4');
    });

    it('accepts object size fallbacks and rejects incomplete object levels', () => {
        const book = normalizeOrderbook({
            bids: [
                { price: '2', amount: null, size: '3' },
                { price: '1', amount: '', size: '4' },
                { amount: '2' },
                {},
            ],
            asks: [],
        });

        expect(book.bids).toEqual([{
            price: '2',
            displayPrice: '2',
            size: '3',
            displaySize: '3',
            cumulative: '3',
        }]);
        expect(book.maxCumulative).toBe('3');
    });

    it('rejects primitive responses and empty direct wrappers', () => {
        const empty = { bids: [], asks: [], maxCumulative: '0' };
        expect(normalizeOrderbook('not-a-book')).toEqual(empty);
        expect(normalizeOrderbook([])).toEqual(empty);
        expect(normalizeOrderbook([null])).toEqual(empty);
    });

    it('keeps a populated side when the other side is absent', () => {
        expect(normalizeOrderbook({ asks: [['1', '2']] })).toEqual({
            bids: [],
            asks: [{
                price: '1',
                displayPrice: '1',
                size: '2',
                displaySize: '2',
                cumulative: '2',
            }],
            maxCumulative: '2',
        });
    });
});
