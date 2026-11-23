// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { quoteMultipartFile } from '../../../packages/core/src/flows/multipartFilePlan.js';
import {
    multipartMethodSummaries,
    multipartReviewFee,
} from '../../../packages/core/src/flows/multipartMethodOptions.js';

const quote = (parts, fee = 100) => ({
    parts,
    transactions: Math.ceil((parts + 1) / 100) + (2 * (parts + 1)),
    fee,
    fundingTotal: fee,
});

function fundedQuote(parts) {
    return quoteMultipartFile({
        parts: Array.from({ length: parts }, () => ({ byteLength: 900 })),
        totalParts: parts,
    }, 6, { type: 'envelope', outputFloor: 546 }, {
        envelopePairVbytes: (bytes) => (bytes > 0 ? bytes : 1024) + 100,
    });
}

describe('multipart method summaries for available quotes', () => {
    it.each([
        [2, 7],
        [26, 55],
        [65_535, 131_728],
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

describe('multipart review funding total', () => {
    it.each([26, 1])('matches the funded output total for a %i-part file', (parts) => {
        const priced = fundedQuote(parts);

        expect(multipartReviewFee(priced)).toBe(
            priced.outputs.reduce((total, value) => total + value, 0),
        );
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
        ['fractional parts', { parts: 2.5, transactions: 7, fundingTotal: 1 }],
        ['too few parts', { parts: 1, transactions: 5, fundingTotal: 1 }],
        ['too many parts', { parts: 65_536, transactions: 131_075, fundingTotal: 1 }],
        ['wrong transaction count', { parts: 2, transactions: 8, fundingTotal: 1 }],
        ['fractional transactions', { parts: 2, transactions: 7.5, fundingTotal: 1 }],
        ['negative fee', { parts: 2, transactions: 7, fundingTotal: -1 }],
        ['infinite fee', { parts: 2, transactions: 7, fundingTotal: Infinity }],
        ['non-number fee', { parts: 2, transactions: 7, fundingTotal: '1' }],
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
            taproot: { parts: 2, transactions: 7, fundingTotal: NaN },
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
