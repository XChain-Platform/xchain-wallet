// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    classifyRecipientEntries,
    classifyRecipientEntriesAsync,
    parseCsv,
    parseCsvEntries,
    parsePasteEntries,
} from '../../../packages/core/src/airdrop/parseRecipients.js';

const BTC_MAINNET = { coin: 'bitcoin', network: 'mainnet' };
const LINE_FIXTURE = readFileSync(
    'test/unit/airdrop/fixtures/recipient-lines.csv',
    'utf8',
);

describe('parseCsv edge cases', () => {
    it.each([undefined, null, 42, {}, [], ''])(
        'returns no recipients for non-text or empty input %#',
        (input) => {
            expect(parseCsv(input)).toEqual([]);
        },
    );

    it('returns no recipients for records containing only blank cells', () => {
        expect(parseCsv('\uFEFF,  \r\n,\n')).toEqual([]);
    });

    it('finds a case-insensitive header after blank rows and a BOM', () => {
        expect(parseCsv('\uFEFF\r\n,\r\n AdDrEsS ,label\r\nalpha,first\r\n'))
            .toEqual(['alpha']);
    });

    it('keeps the first content row when it is not a header', () => {
        expect(parseCsv('alpha,first\nbeta,second')).toEqual(['alpha', 'beta']);
    });

    it('uses only non-empty first-column cells and trims their values', () => {
        expect(parseCsv('address,label\n ,ignored\n alpha ,one\n\uFEFFbeta,two\n'))
            .toEqual(['alpha', 'beta']);
    });

    it('keeps commas and escaped quotes inside a quoted first column', () => {
        expect(parseCsv('"alpha,beta",one\n"gamma""delta",two'))
            .toEqual(['alpha,beta', 'gamma"delta']);
    });

    it('retains physical record lines and reports invalid CSV rows by line', () => {
        const entries = parseCsvEntries(LINE_FIXTURE);
        expect(entries.map(({ line }) => line)).toEqual([3, 4, 5, 7, 8]);

        const result = classifyRecipientEntries(entries, BTC_MAINNET);
        expect(result.valid).toEqual(['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu']);
        expect(result.duplicates).toBe(1);
        expect(result.invalidLines).toEqual([
            { address: 'not-an-address', line: 4 },
            { address: 'still-not-valid', line: 5 },
            { address: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', line: 8 },
        ]);
        expect(result.wrongNetworkLines).toEqual([
            { address: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', line: 8 },
        ]);
    });

    it('uses the same line-aware duplicate rule for paste and CSV input', () => {
        const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
        const entries = parsePasteEntries(`invalid,${address}\n\n${address.toUpperCase()}`);

        expect(entries).toEqual([
            { value: 'invalid', line: 1 },
            { value: address, line: 1 },
            { value: address.toUpperCase(), line: 3 },
        ]);
        const result = classifyRecipientEntries(entries, BTC_MAINNET);
        expect(result.valid).toEqual([address]);
        expect(result.invalidLines).toEqual([{ address: 'invalid', line: 1 }]);
        expect(result.duplicates).toBe(1);
    });

    it('classifies a very long paste list in yielding chunks without losing lines', async () => {
        const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
        const invalidRows = Array.from({ length: 20_000 }, (_, index) => `invalid-${index + 1}`);
        invalidRows[0] = address;
        invalidRows[19_999] = address.toUpperCase();
        const entries = parsePasteEntries(invalidRows.join('\n'));
        let yields = 0;
        const result = await classifyRecipientEntriesAsync(entries, BTC_MAINNET, {
            chunkSize: 500,
            yieldTask: async () => { yields += 1; },
        });

        expect(result.valid).toEqual([address]);
        expect(result.invalid).toHaveLength(19_998);
        expect(result.invalidLines.at(-1)).toEqual({ address: 'invalid-19999', line: 19_999 });
        expect(result.duplicates).toBe(1);
        expect(yields).toBe(39);
    });
});
