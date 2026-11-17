// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { multipartFundingEncoderOpts } from '../../../packages/core/src/flows/multipartFundingOpts.js';

const SOURCE = {
    address: 'bcrt1qmultipartsource',
    publicKey: `02${'ab'.repeat(32)}`,
};

function request(pieceValues) {
    return multipartFundingEncoderOpts({ source: SOURCE, pieceValues, rate: 1 });
}

function expectPieceValuesInvalid(pieceValues) {
    expect(() => request(pieceValues)).toThrow(expect.objectContaining({
        code: 'FILE_FUNDING_OPTS_INVALID',
        message: expect.stringContaining('pieceValues'),
    }));
}

describe('multipart funding wave boundaries', () => {
    it.each([1, 33, 100])('maps %i piece values to custom outputs in order', (count) => {
        const pieceValues = Array.from({ length: count }, (_, index) => 10_000 + index);

        expect(request(pieceValues).customOutputs).toEqual(
            pieceValues.map((value) => ({ address: SOURCE.address, value })),
        );
    });

    it('refuses empty and over-wave piece value lists', () => {
        expectPieceValuesInvalid([]);
        expectPieceValuesInvalid(Array(101).fill(1));
    });

    it('keeps the 27-output encoder request unchanged', () => {
        const pieceValues = Array.from({ length: 27 }, (_, index) => 10_000 + index);

        expect(request(pieceValues)).toEqual({
            pubkey: SOURCE.address,
            sourceAddress: SOURCE.address,
            change: SOURCE.address,
            customOutputs: pieceValues.map((value) => ({ address: SOURCE.address, value })),
            feePerKb: 1000,
        });
    });
});
