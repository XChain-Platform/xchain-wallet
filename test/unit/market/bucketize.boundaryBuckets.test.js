// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bucketizeMatches } from '../../../packages/core/src/market/bucketize.js';

describe('market/bucketize period boundaries', () => {
    it('places adjacent timestamps on opposite sides of an exact boundary', () => {
        const options = { tick1: 'TOKEN', tick2: 'BTC', periodSeconds: 60 };
        const rows = [
            { type: 'buy', price: '1', amount: '2', timestamp: 59 },
            { type: 'sell', price: '3', amount: '4', timestamp: 60 },
        ];

        expect(bucketizeMatches(rows, options)).toEqual([
            {
                time: 0,
                open: 1,
                high: 1,
                low: 1,
                close: 1,
                volume: 2,
                exactVolume: '2',
            },
            {
                time: 60,
                open: 3,
                high: 3,
                low: 3,
                close: 3,
                volume: 4,
                exactVolume: '4',
            },
        ]);
    });
});
