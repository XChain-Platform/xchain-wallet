// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { multipartMethodSummaries } from '../../../packages/core/src/flows/multipartMethodOptions.js';

const quote = (parts, fee = 100) => ({
    parts,
    transactions: 1 + (2 * (parts + 1)),
    fee,
});

describe('multipart method summaries for available quotes', () => {
    it.each([
        [2, 7],
        [26, 55],
        [32, 67],
    ])('formats a %i-part quote with %i transactions', (parts, transactions) => {
        const taproot = quote(parts, 123.5);
        const result = multipartMethodSummaries({ taproot, standard: null });

        expect(result.taproot).toEqual({
            summary: `${parts} parts, ${transactions} transactions`,
            fee: 123.5,
        });
    });

    it('returns summaries and fees for both methods', () => {
        expect(multipartMethodSummaries({
            taproot: quote(3, 0),
            standard: quote(4, 456),
        })).toEqual({
            taproot: { summary: '3 parts, 9 transactions', fee: 0 },
            standard: { summary: '4 parts, 11 transactions', fee: 456 },
        });
    });
});

describe('multipart method summaries for unavailable quotes', () => {
    it('keeps one unavailable method empty', () => {
        expect(multipartMethodSummaries({
            taproot: quote(2, 10),
            standard: null,
        })).toEqual({
            taproot: { summary: '2 parts, 7 transactions', fee: 10 },
            standard: { summary: null, fee: null },
        });
    });

    it('keeps both unavailable methods empty', () => {
        const empty = { summary: null, fee: null };
        expect(multipartMethodSummaries({ taproot: null, standard: null }))
            .toEqual({ taproot: empty, standard: empty });
    });
});

describe('invalid multipart quotes', () => {
    it.each([
        ['fractional parts', { parts: 2.5, transactions: 7, fee: 1 }],
        ['too few parts', { parts: 1, transactions: 5, fee: 1 }],
        ['too many parts', { parts: 33, transactions: 69, fee: 1 }],
        ['wrong transaction count', { parts: 2, transactions: 8, fee: 1 }],
        ['fractional transactions', { parts: 2, transactions: 7.5, fee: 1 }],
        ['negative fee', { parts: 2, transactions: 7, fee: -1 }],
        ['infinite fee', { parts: 2, transactions: 7, fee: Infinity }],
        ['non-number fee', { parts: 2, transactions: 7, fee: '1' }],
    ])('rejects %s', (_label, invalid) => {
        let thrown;
        try {
            multipartMethodSummaries({ taproot: null, standard: invalid });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toMatchObject({
            message: expect.stringContaining('standard'),
            code: 'MULTIPART_QUOTE_INVALID',
        });
    });

    it('names taproot when its quote is invalid', () => {
        expect(() => multipartMethodSummaries({
            taproot: { parts: 2, transactions: 7, fee: NaN },
            standard: null,
        })).toThrow(/taproot/);
    });
});

describe('multipart quote input ownership', () => {
    it('does not mutate either input quote or the containing object', () => {
        const input = {
            taproot: quote(26, 101),
            standard: quote(2, 202),
        };
        const before = structuredClone(input);

        multipartMethodSummaries(input);

        expect(input).toEqual(before);
    });
});
