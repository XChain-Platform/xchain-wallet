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
const opts = (overrides = {}) => ({ source: SOURCE, pieceValues: [1000, 2000, 3000], rate: 1, ...overrides });

function expectInvalid(input, field) {
    try {
        multipartFundingEncoderOpts(input);
        throw new Error('expected multipartFundingEncoderOpts to throw');
    } catch (error) {
        expect(error.code).toBe('FILE_FUNDING_OPTS_INVALID');
        expect(error.message).toContain(field);
    }
}

describe('multipart funding encoder request', () => {
    it('returns the exact bare-payment keys and preserves all 27 output values in order', () => {
        const pieceValues = Array.from({ length: 27 }, (_, index) => 10_000 + index);
        const result = multipartFundingEncoderOpts(opts({ pieceValues }));

        expect(Object.keys(result)).toEqual([
            'pubkey', 'sourceAddress', 'change', 'customOutputs', 'feePerKb',
        ]);
        expect(result).toEqual({
            pubkey: SOURCE.publicKey,
            sourceAddress: SOURCE.address,
            change: SOURCE.address,
            customOutputs: pieceValues.map((value) => ({ address: SOURCE.address, value })),
            feePerKb: 1000,
        });
        expect(result.customOutputs.map(({ value }) => value)).toEqual(pieceValues);
        for (const key of ['data', 'rawData', 'utxos', 'options', 'encoding', 'unconfirmed']) {
            expect(result).not.toHaveProperty(key);
        }
        expect(Object.values(result)).not.toContain(undefined);
    });

    it('converts integer and fractional satoshi-per-vbyte rates to feePerKb', () => {
        expect(multipartFundingEncoderOpts(opts({ rate: 1 })).feePerKb).toBe(1000);
        expect(multipartFundingEncoderOpts(opts({ rate: 12.5 })).feePerKb).toBe(12_500);
    });
});

describe('multipart funding piece count bounds', () => {
    it('accepts 3 and 33 entries', () => {
        expect(multipartFundingEncoderOpts(opts({ pieceValues: [1, 2, 3] })).customOutputs).toHaveLength(3);
        expect(multipartFundingEncoderOpts(opts({ pieceValues: Array(33).fill(1) })).customOutputs).toHaveLength(33);
    });

    it('refuses 2 and 34 entries', () => {
        expectInvalid(opts({ pieceValues: [1, 2] }), 'pieceValues');
        expectInvalid(opts({ pieceValues: Array(34).fill(1) }), 'pieceValues');
    });
});

describe('multipart funding input validation', () => {
    it('refuses invalid public keys', () => {
        for (const publicKey of ['', `04${'ab'.repeat(32)}`, `02${'ab'.repeat(31)}`, `02${'xz'.repeat(32)}`, 2]) {
            expectInvalid(opts({ source: { ...SOURCE, publicKey } }), 'source.publicKey');
        }
    });

    it('refuses an empty address', () => {
        expectInvalid(opts({ source: { ...SOURCE, address: '' } }), 'source.address');
        expectInvalid(opts({ source: { ...SOURCE, address: '   ' } }), 'source.address');
    });

    it('refuses a non-array pieceValues value', () => {
        expectInvalid(opts({ pieceValues: '1000,2000,3000' }), 'pieceValues');
    });

    it('refuses entries that are not positive safe integers', () => {
        for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
            expectInvalid(opts({ pieceValues: [1, value, 3] }), 'pieceValues[1]');
        }
    });

    it('refuses non-finite and non-positive rates', () => {
        for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
            expectInvalid(opts({ rate }), 'rate');
        }
    });
});

describe('multipart funding input immutability', () => {
    it('does not mutate the source, values, or request', () => {
        const input = {
            source: { ...SOURCE },
            pieceValues: [1000, 2000, 3000],
            rate: 12.5,
        };
        const snapshot = structuredClone(input);

        const result = multipartFundingEncoderOpts(input);

        expect(input).toEqual(snapshot);
        expect(result.customOutputs).not.toBe(input.pieceValues);
    });
});
