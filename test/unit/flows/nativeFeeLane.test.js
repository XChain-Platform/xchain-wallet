// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which transaction carries the native-coin protocol fee.
//
// The defect this guards was silent and expensive: the fee rode the phase-1
// commit while the indexer checks the phase-2 reveal, so on LTC/DOGE (where
// native is the only fee lane) every chunked action paid and was rejected.
//
// then found the second half: the output has to be HANDED to the phase-1
// build even though it is emitted on phase 2, because the reveal spends only
// the commit's outputs and the encoder sizes them from the customOutputs it was
// given. Placement therefore moved off a size prediction and on to the encoding
// the encoder reported, which is what isChunkEncoding answers.

import { describe, it, expect } from 'vitest';
import {
    nativeFeeOutputOf, isChunkEncoding, withoutCustomOutput,
} from '../../../packages/core/src/flows/nativeFeeLane.js';

const QUOTE = { feeDestination: 'mfees5pa2HwNBonk5vG23aDWkN9fuDJib4', requiredFeeSats: 2084 };
const FEE_OUT = { address: QUOTE.feeDestination, value: 2084 };

describe('nativeFeeOutputOf', () => {
    it('derives the output from the quote', () => {
        expect(nativeFeeOutputOf(QUOTE)).toEqual(FEE_OUT);
    });

    // A zero fee is not an output. Pushing a 0-value output would be a dust
    // rejection at best and a confusing extra output at worst.
    it('is null for a missing, zero or unpriced fee', () => {
        expect(nativeFeeOutputOf(null)).toBe(null);
        expect(nativeFeeOutputOf({ ...QUOTE, requiredFeeSats: 0 })).toBe(null);
        expect(nativeFeeOutputOf({ ...QUOTE, requiredFeeSats: 'nonsense' })).toBe(null);
        expect(nativeFeeOutputOf({ requiredFeeSats: 2084 })).toBe(null);
    });
});

describe('isChunkEncoding', () => {
    it('is true for the two-phase encodings, in any case', () => {
        expect(isChunkEncoding('P2SH')).toBe(true);
        expect(isChunkEncoding('P2WSH')).toBe(true);
        expect(isChunkEncoding('p2sh')).toBe(true);
    });

    it('is false for the single-transaction encodings and for no encoding', () => {
        expect(isChunkEncoding('OP_RETURN')).toBe(false);
        expect(isChunkEncoding('MULTISIGN')).toBe(false);
        expect(isChunkEncoding(null)).toBe(false);
        expect(isChunkEncoding(undefined)).toBe(false);
        expect(isChunkEncoding('')).toBe(false);
    });
});

describe('withoutCustomOutput', () => {
    it('removes only the exact output', () => {
        const opts = { customOutputs: [{ address: 'a', value: 1 }, FEE_OUT, { address: 'b', value: 2 }] };
        expect(withoutCustomOutput(opts, FEE_OUT).customOutputs)
            .toEqual([{ address: 'a', value: 1 }, { address: 'b', value: 2 }]);
    });

    // An ADS donation or an oracle usage fee can legitimately pay the same
    // address; only the matching VALUE is the protocol fee.
    it('leaves a same-address output with a different value alone', () => {
        const other = { address: FEE_OUT.address, value: 999 };
        const opts = { customOutputs: [other, FEE_OUT] };
        expect(withoutCustomOutput(opts, FEE_OUT).customOutputs).toEqual([other]);
    });

    it('does not mutate the caller and tolerates no outputs', () => {
        const opts = { customOutputs: [FEE_OUT] };
        withoutCustomOutput(opts, FEE_OUT);
        expect(opts.customOutputs).toEqual([FEE_OUT]);
        expect(withoutCustomOutput({}, FEE_OUT).customOutputs).toEqual([]);
    });
});
