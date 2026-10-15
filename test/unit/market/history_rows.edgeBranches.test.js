// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    historyTimestamp,
    normalizeMarketHistoryRow,
    normalizeMarketHistoryRowExact,
} from '../../../packages/core/src/market/history_rows.js';

describe('market/history_rows edge branches', () => {
    it('trims projected amounts and reads camel-case metadata', () => {
        expect(normalizeMarketHistoryRowExact({
            type: 'SELL',
            price: ' 2.500 ',
            amount: ' 4.00 ',
            timestamp: 100,
            actionIndex: '7',
            txHash: 'tx',
        }, 'TOKEN', 'BTC')).toEqual({
            price: '2.500',
            amount: '4.00',
            side: 'sell',
            timestamp: 100,
            actionIndex: '7',
            txHash: 'tx',
        });
    });

    it('falls back from invalid projected fields to camel-case raw fields', () => {
        expect(normalizeMarketHistoryRowExact({
            type: 'hold',
            price: '9',
            amount: '9',
            giveTick: 'TOKEN',
            getTick: 'BTC',
            giveAmount: '2',
            getAmount: '5',
            timestamp: 100,
        }, 'TOKEN', 'BTC')).toEqual({
            price: '2.5',
            amount: '2',
            side: 'sell',
            timestamp: 100,
            actionIndex: null,
            txHash: null,
        });
    });

    it('rejects raw rows with missing ticks, invalid get amounts, or foreign pairs', () => {
        const base = {
            give_tick: 'TOKEN',
            get_tick: 'BTC',
            give_amount: '2',
            get_amount: '5',
            timestamp: 100,
        };
        expect(normalizeMarketHistoryRowExact({ ...base, give_tick: '' }, 'TOKEN', 'BTC'))
            .toBeNull();
        expect(normalizeMarketHistoryRowExact({ ...base, get_amount: '0' }, 'TOKEN', 'BTC'))
            .toBeNull();
        expect(normalizeMarketHistoryRowExact({
            ...base,
            give_tick: 'OTHER',
            get_tick: 'ELSE',
        }, 'TOKEN', 'BTC')).toBeNull();
        expect(normalizeMarketHistoryRow(null, 'TOKEN', 'BTC')).toBeNull();
    });

    it('falls through invalid preferred timestamps to the next source', () => {
        expect(historyTimestamp({ timestamp: 1.5, block_time: ' 200 ' })).toBe(200);
        expect(historyTimestamp({ timestamp: 'invalid', block_time: 300 })).toBe(300);
        expect(historyTimestamp({
            timestamp: 10_000_000_000,
            block_time: null,
            created_at: '1970-01-01T00:00:01.000Z',
        })).toBe(1);
    });

    it('rejects empty, epoch, and out-of-window created times', () => {
        expect(historyTimestamp({ created_at: '' })).toBeNull();
        expect(historyTimestamp({ created_at: '1970-01-01T00:00:00.000Z' })).toBeNull();
        expect(historyTimestamp({ created_at: '2500-01-01T00:00:00.000Z' })).toBeNull();
        expect(historyTimestamp({ created_at: 100 })).toBeNull();
    });
});
