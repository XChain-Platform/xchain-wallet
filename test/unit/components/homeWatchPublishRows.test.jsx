// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { watchPublishRows } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const rows = [
    { chainId: 'bitcoin-mainnet', tick: 'BTC', displayName: 'Bitcoin' },
    { chainId: 'bitcoin-mainnet', tick: 'ORDI', displayName: 'Ordinals' },
    { chainId: 'dogecoin-mainnet', tick: 'DOGE', displayName: 'Dogecoin' },
    { chainId: 'dogecoin-mainnet', tick: 'ORDI', displayName: 'Doginals' },
];

describe('watchPublishRows', () => {
    it('keeps every row in input order when both hide sets are absent or empty', () => {
        expect(watchPublishRows(rows)).toEqual(rows);
        expect(watchPublishRows(rows, new Set(), new Set())).toEqual(rows);
    });

    it('removes a manually hidden row', () => {
        expect(watchPublishRows(rows, new Set(['bitcoin-mainnet:ORDI'])))
            .toEqual([rows[0], rows[2], rows[3]]);
    });

    it('removes an automatically hidden row', () => {
        expect(watchPublishRows(rows, undefined, new Set(['dogecoin-mainnet:DOGE'])))
            .toEqual([rows[0], rows[1], rows[3]]);
    });

    it('keeps rows excluded from a search-derived filtered list', () => {
        const filteredRows = rows.filter((row) => row.displayName.includes('Bitcoin'));

        expect(filteredRows).toEqual([rows[0]]);
        expect(watchPublishRows(rows)).toContain(rows[1]);
        expect(watchPublishRows(rows)).toEqual(rows);
    });

    it('keeps input order while applying both hide sets', () => {
        expect(watchPublishRows(
            rows,
            new Set(['dogecoin-mainnet:ORDI']),
            new Set(['bitcoin-mainnet:BTC']),
        )).toEqual([rows[1], rows[2]]);
    });
});
