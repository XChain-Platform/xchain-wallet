// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    actionRowIdentity,
    explorerPage,
    uniqueRows,
} from '../../../../packages/core/src/shared/utils/pagedRows.js';

describe('shared/utils/pagedRows uniqueRows', () => {
    it.each([
        ['keeps the first stable identity', [{ id: 1 }, { id: 1 }, { id: 2 }], [1, 2]],
        ['matches numeric and string identities', [{ id: 1 }, { id: '1' }, { id: 2 }], [1, 2]],
        ['keeps rows without identities', [{ id: null }, {}, { id: '' }], [null, undefined, '']],
        ['accepts a non-array input', null, []],
    ])('%s', (_label, rows, expectedIds) => {
        expect(uniqueRows(rows, (row) => row.id).map((row) => row.id)).toEqual(expectedIds);
    });
});

describe('shared/utils/pagedRows explorerPage', () => {
    it.each([
        ['uses total', { total: 21 }, 10, 2, 10, { total: 21, hasMore: true }],
        ['ends on the last page', { total: 20 }, 10, 2, 10, { total: 20, hasMore: false }],
        ['uses recordsTotal', { recordsTotal: '11' }, 10, 1, 10, { total: 11, hasMore: true }],
        ['uses count', { count: 4 }, 4, 1, 10, { total: 4, hasMore: false }],
        ['falls back after a negative total', { total: -1, recordsTotal: 12 }, 10, 1, 10, { total: 12, hasMore: true }],
        ['infers another full page', {}, 10, 1, 10, { total: null, hasMore: true }],
        ['infers the final short page', {}, 3, 2, 10, { total: null, hasMore: false }],
    ])('%s', (_label, response, rowCount, page, pageSize, expected) => {
        expect(explorerPage(response, Array(rowCount), page, pageSize)).toEqual(expected);
    });
});

describe('shared/utils/pagedRows actionRowIdentity', () => {
    it.each([
        ['snake case action index', { action_index: 0, actionIndex: 1 }, 0],
        ['camel case action index', { actionIndex: 2, tx_hash: 'hash' }, 2],
        ['transaction hash', { tx_hash: 'hash', txid: 'txid' }, 'hash'],
        ['transaction id', { txid: 'txid', id: 'id' }, 'txid'],
        ['generic id', { id: 'id' }, 'id'],
        ['missing identity', {}, null],
        ['missing row', null, null],
    ])('selects %s', (_label, row, expected) => {
        expect(actionRowIdentity(row)).toBe(expected);
    });
});
