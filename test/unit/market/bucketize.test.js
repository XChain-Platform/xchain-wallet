// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PERIOD_ID,
    PERIODS,
    bucketizeMatches,
} from '../../../packages/core/src/market/bucketize.js';

const OPTIONS = { tick1: 'TOKEN', tick2: 'BTC', periodSeconds: 300 };

describe('market/bucketize', () => {
    it('publishes the supported chart periods and default', () => {
        expect(DEFAULT_PERIOD_ID).toBe('1h');
        expect(PERIODS.map(({ id, seconds }) => [id, seconds])).toEqual([
            ['1m', 60],
            ['5m', 300],
            ['15m', 900],
            ['1h', 3600],
            ['4h', 14400],
            ['1d', 86400],
            ['1w', 604800],
            ['30d', 2592000],
            ['60d', 5184000],
            ['90d', 7776000],
        ]);
    });

    it('builds time-ordered OHLC candles from unsorted projected rows', () => {
        const rows = [
            { type: 'buy', price: '3', amount: '1', timestamp: 250 },
            { type: 'sell', price: '2', amount: '9007199254740992', timestamp: 61 },
            { type: 'buy', price: '4', amount: '0.5', timestamp: 200 },
            { type: 'sell', price: '1', amount: '1', timestamp: 100 },
            { type: 'buy', price: '5', amount: '2', timestamp: 360 },
        ];

        expect(bucketizeMatches(rows, OPTIONS)).toEqual([
            {
                time: 0,
                open: 2,
                high: 4,
                low: 1,
                close: 3,
                volume: Number('9007199254740994.5'),
                exactVolume: '9007199254740994.5',
            },
            {
                time: 300,
                open: 5,
                high: 5,
                low: 5,
                close: 5,
                volume: 2,
                exactVolume: '2',
            },
        ]);
    });

    it('accepts both raw match orientations and reports tick1 volume', () => {
        const candles = bucketizeMatches([
            {
                give_tick: 'TOKEN',
                get_tick: 'BTC',
                give_amount: '4',
                get_amount: '10',
                timestamp: 310,
            },
            {
                give_tick: 'BTC',
                get_tick: 'TOKEN',
                give_amount: '6',
                get_amount: '2',
                timestamp: 320,
            },
        ], OPTIONS);

        expect(candles).toEqual([{
            time: 300,
            open: 2.5,
            high: 3,
            low: 2.5,
            close: 3,
            volume: 6,
            exactVolume: '6',
        }]);
    });

    it('skips malformed rows and rejects unusable arguments', () => {
        const valid = { type: 'buy', price: '2', amount: '3', timestamp: 10 };
        expect(bucketizeMatches([{}, valid, { ...valid, amount: '0' }], OPTIONS))
            .toHaveLength(1);
        expect(bucketizeMatches(null, OPTIONS)).toEqual([]);
        expect(bucketizeMatches([], OPTIONS)).toEqual([]);
        expect(bucketizeMatches([valid], { ...OPTIONS, tick1: '' })).toEqual([]);
        expect(bucketizeMatches([valid], { ...OPTIONS, tick2: '' })).toEqual([]);
        expect(bucketizeMatches([valid], { ...OPTIONS, periodSeconds: 0 })).toEqual([]);
        expect(bucketizeMatches([valid], { ...OPTIONS, periodSeconds: Number.NaN })).toEqual([]);
    });
});
