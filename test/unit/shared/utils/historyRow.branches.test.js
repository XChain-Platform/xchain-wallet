// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    flattenActionDetails,
    normalizeHistoryRow,
} from '../../../../packages/core/src/shared/utils/historyRow.js';

describe('history row branch coverage', () => {
    it('keeps invalid rows and applies detail overwrite guards', () => {
        expect(flattenActionDetails(undefined)).toBeUndefined();
        expect(flattenActionDetails('row')).toBe('row');
        expect(flattenActionDetails({ details: [] })).toEqual({ details: [] });
        expect(flattenActionDetails({
            source: 'top',
            destination: null,
            tick: '',
            details: {
                source: 'nested',
                destination: 'filled-null',
                tick: 'filled-empty',
                memo: null,
            },
        })).toMatchObject({
            source: 'top',
            destination: 'filled-null',
            tick: 'filled-empty',
        });
    });

    it('rejects rows without either action-index spelling', () => {
        expect(normalizeHistoryRow(null, { chainId: 'btc', address: 'wallet' })).toBeNull();
        expect(normalizeHistoryRow({}, { chainId: 'btc', address: 'wallet' })).toBeNull();
    });

    it('normalizes snake-case fields and the default link', () => {
        const row = {
            action_index: 7,
            action: 'SEND',
            block_index: '8',
            timestamp: '9',
            tx_hash: 10,
            details: { source: 'nested-source' },
        };

        expect(normalizeHistoryRow(row, { chainId: 'btc', address: 'wallet' })).toEqual({
            key: 'btc:7:wallet',
            chainId: 'btc',
            address: 'wallet',
            actionIndex: '7',
            action: 'SEND',
            blockIndex: 8,
            timestamp: 9,
            txHash: '10',
            source: 'nested-source',
            raw: flattenActionDetails(row),
            link: null,
        });
    });

    it('accepts camel-case and uppercase field fallbacks', () => {
        const link = { actionIndex: 'other' };
        const row = {
            actionIndex: 11,
            ACTION: 'MINT',
            blockIndex: '12',
            block_time: '13',
            txHash: 14,
            SOURCE: 'uppercase-source',
        };

        expect(normalizeHistoryRow(row, {
            chainId: 'ltc',
            address: 'wallet',
            link,
        })).toMatchObject({
            actionIndex: '11',
            action: 'MINT',
            blockIndex: 12,
            timestamp: 13,
            txHash: '14',
            source: 'uppercase-source',
            link,
        });
    });

    it('uses stable defaults for absent optional fields', () => {
        expect(normalizeHistoryRow({ action_index: 15 }, {
            chainId: 'doge',
            address: 'wallet',
        })).toMatchObject({
            action: 'ACTION',
            blockIndex: 0,
            timestamp: 0,
            txHash: '',
            source: '',
        });
    });
});
