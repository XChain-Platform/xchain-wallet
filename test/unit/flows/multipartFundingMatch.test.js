// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    fundingMatchesQuote,
    matchFundingOutputs,
} from '../../../packages/core/src/flows/multipartFundingMatch.js';

const expected = [
    { address: 'source-a', value: 1200 },
    { address: 'source-a', value: 1200 },
    { address: 'source-b', value: 900 },
];

const shuffled = [
    { vout: 8, address: 'change', value: 50, scriptPubKey: 'change-script' },
    { vout: 4, address: 'source-a', value: 1200, scriptPubKey: 'piece-1-script' },
    { vout: 2, address: 'source-b', value: 900, scriptPubKey: 'manifest-script' },
    { vout: 7, address: 'source-a', value: 1200, scriptPubKey: 'piece-0-script' },
];

describe('matchFundingOutputs matching', () => {
    it('matches shuffled same-value pieces to distinct outputs in piece order', () => {
        expect(matchFundingOutputs(expected, shuffled, 'funding-txid')).toEqual([
            { txid: 'funding-txid', vout: 4, value: 1200, scriptPubKey: 'piece-1-script' },
            { txid: 'funding-txid', vout: 7, value: 1200, scriptPubKey: 'piece-0-script' },
            { txid: 'funding-txid', vout: 2, value: 900, scriptPubKey: 'manifest-script' },
        ]);
    });

    it('ignores an extra change output', () => {
        expect(matchFundingOutputs([expected[2]], shuffled, 'tx')).toEqual([
            { txid: 'tx', vout: 2, value: 900, scriptPubKey: 'manifest-script' },
        ]);
    });

    it('accepts an empty quote', () => {
        expect(matchFundingOutputs([], shuffled, 'tx')).toEqual([]);
        expect(fundingMatchesQuote([], [])).toBe(true);
    });
});

describe('matchFundingOutputs missing output refusals', () => {
    it('does not take an equal-value output paid to another address', () => {
        const outputs = [{ vout: 0, address: 'other', value: 1200, scriptPubKey: 'script' }];
        expect(() => matchFundingOutputs([expected[0]], outputs, 'tx')).toThrowError(
            expect.objectContaining({ code: 'FUNDING_OUTPUT_MISSING', message: expect.stringContaining('piece 0') }),
        );
        expect(fundingMatchesQuote([expected[0]], outputs)).toBe(false);
    });

    it('names the missing piece index after consuming earlier matches', () => {
        expect(() => matchFundingOutputs(expected, shuffled.slice(0, 3), 'tx')).toThrowError(
            expect.objectContaining({ code: 'FUNDING_OUTPUT_MISSING', message: expect.stringContaining('piece 1') }),
        );
    });

    it('rejects a value off by one', () => {
        const outputs = [{ vout: 0, address: 'source-a', value: 1199, scriptPubKey: 'script' }];
        expect(() => matchFundingOutputs([expected[0]], outputs, 'tx')).toThrowError(
            expect.objectContaining({ code: 'FUNDING_OUTPUT_MISSING' }),
        );
        expect(fundingMatchesQuote([expected[0]], outputs)).toBe(false);
    });
});

describe('matchFundingOutputs input refusals', () => {
    it.each([
        ['expected outputs', null, []],
        ['funding outputs', [], null],
    ])('rejects non-array %s', (_label, expectedOutputs, fundingOutputs) => {
        expect(() => matchFundingOutputs(expectedOutputs, fundingOutputs, 'tx')).toThrowError(
            expect.objectContaining({ code: 'FUNDING_INPUT_INVALID' }),
        );
        expect(fundingMatchesQuote(expectedOutputs, fundingOutputs)).toBe(false);
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1200'])('rejects invalid expected value %s', (value) => {
        expect(() => matchFundingOutputs([{ address: 'source-a', value }], [], 'tx')).toThrowError(
            expect.objectContaining({ code: 'FUNDING_INPUT_INVALID' }),
        );
    });

    it('rejects an invalid decoded output value', () => {
        const outputs = [{ vout: 0, address: 'source-a', value: -1, scriptPubKey: 'script' }];
        expect(() => matchFundingOutputs(expected, outputs, 'tx')).toThrowError(
            expect.objectContaining({ code: 'FUNDING_INPUT_INVALID' }),
        );
        expect(fundingMatchesQuote(expected, outputs)).toBe(false);
    });

    it.each(['', '   ', null])('rejects an empty funding transaction id', (txid) => {
        expect(() => matchFundingOutputs([], [], txid)).toThrowError(
            expect.objectContaining({ code: 'FUNDING_INPUT_INVALID' }),
        );
    });
});

describe('multipart funding input immutability', () => {
    it('does not mutate either input', () => {
        const expectedSnapshot = structuredClone(expected);
        const outputsSnapshot = structuredClone(shuffled);
        matchFundingOutputs(expected, shuffled, 'tx');
        fundingMatchesQuote(expected, shuffled);
        expect(expected).toEqual(expectedSnapshot);
        expect(shuffled).toEqual(outputsSnapshot);
    });
});
