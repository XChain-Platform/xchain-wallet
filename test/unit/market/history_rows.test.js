// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    historyTimestamp,
    normalizeMarketHistoryRow,
    normalizeMarketHistoryRowExact,
} from '../../../packages/core/src/market/history_rows.js';

describe('market/history_rows', () => {
    it('normalizes projected rows and preserves exact decimal strings', () => {
        const row = {
            type: 'BUY',
            price: '0.100000000000000001',
            amount: '9007199254740993',
            timestamp: '1800000000',
            action_index: 42,
            tx_hash: 'abc123',
        };

        expect(normalizeMarketHistoryRowExact(row, 'TOKEN', 'BTC')).toEqual({
            price: '0.100000000000000001',
            amount: '9007199254740993',
            side: 'buy',
            timestamp: 1_800_000_000,
            actionIndex: 42,
            txHash: 'abc123',
        });
        expect(normalizeMarketHistoryRow(row, 'TOKEN', 'BTC')).toEqual({
            price: Number(row.price),
            amount: Number(row.amount),
            side: 'buy',
            timestamp: 1_800_000_000,
            actionIndex: 42,
            txHash: 'abc123',
        });
    });

    it('orients both raw match directions against tick1', () => {
        const sell = normalizeMarketHistoryRowExact({
            give_tick: 'TOKEN',
            get_tick: 'BTC',
            give_amount: '4',
            get_amount: '10',
            block_time: 1_800_000_001,
            action_index: 7,
        }, 'TOKEN', 'BTC');
        const buy = normalizeMarketHistoryRowExact({
            giveTick: 'BTC',
            getTick: 'TOKEN',
            giveAmount: '10',
            getAmount: '4',
            created_at: '2027-01-15T08:00:00.000Z',
            actionIndex: 8,
            txHash: 'def456',
        }, 'TOKEN', 'BTC');

        expect(sell).toEqual({
            price: '2.5',
            amount: '4',
            side: 'sell',
            timestamp: 1_800_000_001,
            actionIndex: 7,
            txHash: null,
        });
        expect(buy).toEqual({
            price: '2.5',
            amount: '4',
            side: 'buy',
            timestamp: 1_800_000_000,
            actionIndex: 8,
            txHash: 'def456',
        });
    });

    it('selects timestamp fields in explorer preference order', () => {
        expect(historyTimestamp({
            timestamp: '1800000003',
            block_time: 1_800_000_002,
            created_at: '2027-01-15T08:00:00.000Z',
        })).toBe(1_800_000_003);
        expect(historyTimestamp({ block_time: '1800000002' })).toBe(1_800_000_002);
        expect(historyTimestamp({ created_at: '2027-01-15T08:00:00.000Z' }))
            .toBe(1_800_000_000);
    });

    it('rejects incomplete, non-positive, foreign, and undated rows', () => {
        const opts = ['TOKEN', 'BTC'];
        const invalidRows = [
            null,
            {},
            { type: 'buy', price: '1', amount: '1' },
            { type: 'hold', price: '1', amount: '1', timestamp: 1 },
            { type: 'sell', price: '0', amount: '1', timestamp: 1 },
            { type: 'sell', price: '1', amount: '-1', timestamp: 1 },
            {
                give_tick: 'OTHER',
                get_tick: 'BTC',
                give_amount: '1',
                get_amount: '2',
                timestamp: 1,
            },
            {
                give_tick: 'TOKEN',
                get_tick: 'BTC',
                give_amount: 'nope',
                get_amount: '2',
                timestamp: 1,
            },
        ];

        for (const row of invalidRows) {
            expect(normalizeMarketHistoryRowExact(row, ...opts)).toBeNull();
        }
        expect(historyTimestamp({ created_at: 'not-a-date' })).toBeNull();
    });
});
