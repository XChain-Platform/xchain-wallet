// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    EXPORT_COLUMN_DETAILS,
    entriesToCsv,
    entriesToJson,
} from '../../../packages/core/src/flows/historyExport.js';
import { parseCsvRecords } from '../../../packages/core/src/shared/utils/csv.js';

describe('History export serialization', () => {
    it('documents headers, preserves exact amounts, and labels fiat with its currency', () => {
        const csv = entriesToCsv([{
            timestamp: 1_714_000_000,
            raw: {
                tick: 'XCP',
                amount: '9007199254740993.123456789012345678',
                memo: 'Lunch, "shared"\nsecond line',
            },
        }], {
            columns: ['iso', 'tick', 'amount', 'memo', 'fiatCurrency'],
            fiatCurrency: 'eur',
        });

        expect(csv).toBe([
            'Date (ISO 8601 UTC),Asset,Amount,Memo,Fiat currency (EUR)',
            '2024-04-24T23:06:40.000Z,XCP,9007199254740993.123456789012345678,"Lunch, ""shared""\nsecond line",EUR',
            '',
        ].join('\n'));
        expect(EXPORT_COLUMN_DETAILS.amount.description).toContain('no floating-point conversion');
    });

    it('normalizes millisecond timestamps and documents JSON column keys', () => {
        const json = JSON.parse(entriesToJson([{
            timestamp: 1_714_000_000_000,
            raw: {
                AMOUNT: '10000000000000000.00000001',
                MEMO: 'recorded memo',
            },
        }], {
            columns: ['iso', 'amount', 'memo', 'fiatCurrency'],
            fiatCurrency: 'GBP',
        }));

        expect(json.fiatCurrency).toBe('GBP');
        expect(json.columnHeaders).toEqual({
            iso: 'Date (ISO 8601 UTC)',
            amount: 'Amount',
            memo: 'Memo',
            fiatCurrency: 'Fiat currency (GBP)',
        });
        expect(json.entries[0]).toMatchObject({
            iso: '2024-04-24T23:06:40.000Z',
            amount: '10000000000000000.00000001',
            memo: 'recorded memo',
            fiatCurrency: 'GBP',
        });
    });

    it('escapes text fields and neutralizes spreadsheet formulas', () => {
        const csv = entriesToCsv([{
            chainId: '=CHAIN(), "primary"\nlabel',
            address: '+address',
            action: '-action',
            timestamp: 1_714_000_000,
            source: '@source',
            raw: {
                amount: -1234.5,
                memo: '=HYPERLINK("https://example.invalid", "memo")\nnext line',
            },
        }], {
            columns: ['chainId', 'address', 'action', 'source', 'amount', 'memo', 'iso'],
        });

        const records = parseCsvRecords(csv, { strict: true });
        expect(records).toHaveLength(2);
        expect(records[1].cells).toEqual([
            '\'=CHAIN(), "primary"\nlabel',
            "'+address",
            "'-action",
            "'@source",
            "'-1234.5",
            '\'=HYPERLINK("https://example.invalid", "memo")\nnext line',
            '2024-04-24T23:06:40.000Z',
        ]);
        expect(csv).toContain('"\'=CHAIN(), ""primary""\nlabel"');
        expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"", ""memo"")\nnext line"');
    });

    it('serializes numeric amounts with a locale-independent decimal point', () => {
        const csv = entriesToCsv([{ raw: { amount: 1234.5 } }], { columns: ['amount'] });

        expect(csv).toBe('Amount\n1234.5\n');
    });
});
