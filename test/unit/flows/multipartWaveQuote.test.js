// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { multipartWaveQuote } from '../../../packages/core/src/flows/multipartWaveQuote.js';

function outputs(count) {
    return Array.from({ length: count }, (_, index) => index + 1);
}

describe('multipart wave quotes', () => {
    it('keeps a 27-output quote in one wave', () => {
        const values = outputs(27);

        expect(multipartWaveQuote({ outputs: values })).toEqual({
            waves: [{
                index: 0,
                from: 0,
                to: 26,
                outputs: values,
                fundingTotal: values.reduce((sum, value) => sum + value, 0),
            }],
            waveCount: 1,
            transactions: 55,
        });
    });

    it.each([
        [101, [100, 1], 204],
        [102, [100, 2], 206],
        [251, [100, 100, 51], 505],
    ])('splits %i outputs into ordered waves', (count, lengths, transactions) => {
        const values = outputs(count);
        const result = multipartWaveQuote({ outputs: values });

        expect(result.waveCount).toBe(lengths.length);
        expect(result.transactions).toBe(transactions);
        expect(result.waves.map((wave) => wave.outputs.length)).toEqual(lengths);
        let from = 0;
        const expectedRanges = lengths.map((length, index) => {
            const range = { index, from, to: from + length - 1 };
            from += length;
            return range;
        });
        expect(result.waves.map(({ index, from: start, to }) => ({
            index, from: start, to,
        }))).toEqual(expectedRanges);
        expect(result.waves.flatMap((wave) => wave.outputs)).toEqual(values);
        expect(result.waves.map((wave) => wave.fundingTotal)).toEqual(
            result.waves.map((wave) => wave.outputs.reduce((sum, value) => sum + value, 0)),
        );
    });

    it.each([
        undefined,
        {},
        { outputs: [] },
        { outputs: [1, 1.5] },
        { outputs: [1, 0] },
        { outputs: [1, Number.MAX_SAFE_INTEGER + 1] },
    ])('refuses an invalid outputs list', (quote) => {
        expect(() => multipartWaveQuote(quote)).toThrow(
            expect.objectContaining({ code: 'MULTIPART_WAVE_QUOTE_INVALID' }),
        );
    });
});
