// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bucketizeMatches } from '../../../packages/core/src/market/bucketize.js';
import { normalizeMarketHistoryRow } from '../../../packages/core/src/market/history_rows.js';
import { normalizeMarket } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

describe('explorer market response shapes', () => {
    it('buckets the projected market history fields', () => {
        const rows = [
            {
                type: 'buy',
                price: '2.5',
                amount: '4',
                action_index: 31,
                block_index: 900,
                timestamp: 1_800_000_010,
            },
            {
                type: 'sell',
                price: '3',
                amount: '2',
                action_index: 32,
                block_index: 901,
                timestamp: 1_800_000_020,
            },
        ];

        expect(normalizeMarketHistoryRow(rows[0], 'TOKEN', 'BTC')).toEqual({
            price: 2.5,
            amount: 4,
            side: 'buy',
            timestamp: 1_800_000_010,
            actionIndex: 31,
            txHash: null,
        });

        expect(bucketizeMatches(rows, {
            tick1: 'TOKEN',
            tick2: 'BTC',
            periodSeconds: 60,
        })).toEqual([{
            time: 1_800_000_000,
            open: 2.5,
            high: 3,
            low: 2.5,
            close: 3,
            volume: 6,
            exactVolume: '6',
        }]);
    });

    it('normalizes the projected markets list fields', () => {
        const row = {
            id: 7,
            tick1: 'TOKEN',
            tick1_price: '0.00042',
            tick1_24hr_change: '-3.5',
            tick2: 'BTC',
            tick2_price: '2380.95',
            last_updated: 1_800_000_020,
        };

        expect(normalizeMarket(row)).toEqual({
            tick1: 'TOKEN',
            tick2: 'BTC',
            lastPrice: '0.00042',
            change24h: '-3.5',
            depth: undefined,
        });
    });
});
