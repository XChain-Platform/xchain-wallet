// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bucketizeMatches } from '../../../packages/core/src/market/bucketize.js';

const OPTIONS = { tick1: 'TOKEN', tick2: 'BTC', periodSeconds: 60 };

describe('market/bucketize edge branches', () => {
    it('updates both ends of a candle while preserving equal-time insertion order', () => {
        const candles = bucketizeMatches([
            { type: 'buy', price: '2', amount: '1', timestamp: 119 },
            { type: 'sell', price: '4', amount: '2', timestamp: 60 },
            { type: 'buy', price: '1', amount: '3', timestamp: 119 },
            { type: 'sell', price: '3', amount: '4', timestamp: 120 },
        ], OPTIONS);

        expect(candles).toEqual([
            {
                time: 60,
                open: 4,
                high: 4,
                low: 1,
                close: 2,
                volume: 6,
                exactVolume: '6',
            },
            {
                time: 120,
                open: 3,
                high: 3,
                low: 3,
                close: 3,
                volume: 4,
                exactVolume: '4',
            },
        ]);
    });

    it('falls back from an invalid projection to a valid raw match', () => {
        const candles = bucketizeMatches([{
            type: 'unknown',
            price: '99',
            amount: '99',
            give_tick: 'TOKEN',
            get_tick: 'BTC',
            give_amount: '2',
            get_amount: '5',
            timestamp: 61,
        }], OPTIONS);

        expect(candles).toEqual([{
            time: 60,
            open: 2.5,
            high: 2.5,
            low: 2.5,
            close: 2.5,
            volume: 2,
            exactVolume: '2',
        }]);
    });

    it('rejects negative, infinite, and non-numeric periods', () => {
        const row = { type: 'buy', price: '2', amount: '1', timestamp: 60 };
        expect(bucketizeMatches([row], { ...OPTIONS, periodSeconds: -1 })).toEqual([]);
        expect(bucketizeMatches([row], { ...OPTIONS, periodSeconds: Infinity })).toEqual([]);
        expect(bucketizeMatches([row], { ...OPTIONS, periodSeconds: '60' })).toEqual([]);
    });
});
