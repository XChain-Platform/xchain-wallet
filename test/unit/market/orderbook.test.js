// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizeOrderbook } from '../../../packages/core/src/market/orderbook.js';

describe('market/orderbook', () => {
    it('sorts tuple levels and computes cumulative sizes independently', () => {
        const book = normalizeOrderbook({
            bids: [['1', '2.25'], ['3', '0.5'], ['2', '1.25']],
            asks: [['6', '4'], ['4', '1.5'], ['5', '2']],
        });

        expect(book.bids.map(({ price, cumulative }) => [price, cumulative])).toEqual([
            ['3', '0.5'],
            ['2', '1.75'],
            ['1', '4.00'],
        ]);
        expect(book.asks.map(({ price, cumulative }) => [price, cumulative])).toEqual([
            ['4', '1.5'],
            ['5', '3.5'],
            ['6', '7.5'],
        ]);
        expect(book.maxCumulative).toBe('7.5');
    });

    it('unwraps nested explorer data and accepts object levels', () => {
        const book = normalizeOrderbook({
            data: [{
                bids: [{ price: '2', size: '3' }],
                asks: [{ price: '4', amount: '5' }],
            }],
        });

        expect(book).toEqual({
            bids: [{
                price: '2',
                displayPrice: '2',
                size: '3',
                displaySize: '3',
                cumulative: '3',
            }],
            asks: [{
                price: '4',
                displayPrice: '4',
                size: '5',
                displaySize: '5',
                cumulative: '5',
            }],
            maxCumulative: '5',
        });
    });

    it('keeps price ordering and totals exact beyond Number precision', () => {
        const book = normalizeOrderbook({
            bids: [
                ['9007199254740992', '9007199254740992'],
                ['9007199254740993', '1'],
            ],
            asks: [
                ['0.100000000000000002', '0.2'],
                ['0.100000000000000001', '0.1'],
            ],
        });

        expect(book.bids.map(({ price }) => price)).toEqual([
            '9007199254740993',
            '9007199254740992',
        ]);
        expect(book.asks.map(({ price }) => price)).toEqual([
            '0.100000000000000001',
            '0.100000000000000002',
        ]);
        expect(book.bids[1].cumulative).toBe('9007199254740993');
        expect(book.maxCumulative).toBe('9007199254740993');
    });

    it('drops invalid levels and returns an empty book for invalid responses', () => {
        const book = normalizeOrderbook({
            bids: [
                ['2', '3'],
                ['0', '1'],
                ['-1', '1'],
                ['1', '0'],
                ['1e2', '1'],
                ['1'],
                null,
            ],
            asks: 'not-an-array',
        });

        expect(book.bids).toHaveLength(1);
        expect(book.bids[0].price).toBe('2');
        expect(book.asks).toEqual([]);
        expect(book.maxCumulative).toBe('3');
        expect(normalizeOrderbook(null)).toEqual({
            bids: [],
            asks: [],
            maxCumulative: '0',
        });
        expect(normalizeOrderbook({ data: [] })).toEqual({
            bids: [],
            asks: [],
            maxCumulative: '0',
        });
    });
});
