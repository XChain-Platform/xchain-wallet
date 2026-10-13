// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    entriesToCsv,
    entriesToJson,
} from '../../../packages/core/src/flows/historyExport.js';

describe('History export serialization', () => {
    it('uses ISO dates, the selected fiat code, and RFC-4180 memo escaping', () => {
        const csv = entriesToCsv([{
            timestamp: 1_714_000_000,
            raw: { memo: 'Lunch, "shared"\nsecond line' },
        }], {
            columns: ['iso', 'memo', 'fiatCurrency'],
            fiatCurrency: 'eur',
        });

        expect(csv).toBe([
            'iso,memo,fiatCurrency',
            '2024-04-24T23:06:40.000Z,"Lunch, ""shared""\nsecond line",EUR',
            '',
        ].join('\n'));
    });

    it('normalizes millisecond timestamps and carries the fiat code into JSON', () => {
        const json = JSON.parse(entriesToJson([{
            timestamp: 1_714_000_000_000,
            raw: { MEMO: 'recorded memo' },
        }], {
            columns: ['iso', 'memo', 'fiatCurrency'],
            fiatCurrency: 'GBP',
        }));

        expect(json.fiatCurrency).toBe('GBP');
        expect(json.entries[0]).toMatchObject({
            iso: '2024-04-24T23:06:40.000Z',
            memo: 'recorded memo',
            fiatCurrency: 'GBP',
        });
    });
});
