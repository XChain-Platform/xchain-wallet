// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// : which transaction carries the native-coin protocol fee.
//
// The defect this guards was silent and expensive: the fee rode the phase-1
// commit while the indexer checks the phase-2 reveal, so on LTC/DOGE (where
// native is the only fee lane) every chunked action paid and was rejected.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
    nativeFeeOutputOf, willTakeChunkLane, withoutCustomOutput,
    assertFeeLane, FeeLaneMismatchError,
} from '../../../packages/core/src/flows/nativeFeeLane.js';

const require = createRequire(import.meta.url);

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

describe('willTakeChunkLane', () => {
    const short = { actionString: 'SEND|0|PEPE|1|addr' };
    const long = { actionString: `DEPLOY|0|${'x'.repeat(200)}|100000` };

    it('is false for an action that fits one OP_RETURN', () => {
        expect(willTakeChunkLane(short, {})).toBe(false);
    });

    it('is true for an action that does not', () => {
        expect(willTakeChunkLane(long, {})).toBe(true);
    });

    // The encoder honours an explicit encoding, so the prediction must too.
    it('honours an explicitly requested encoding over the size', () => {
        expect(willTakeChunkLane(short, { encoding: 'P2SH' })).toBe(true);
        expect(willTakeChunkLane(short, { encoding: 'p2wsh' })).toBe(true);
        expect(willTakeChunkLane(long, { encoding: 'OP_RETURN' })).toBe(false);
    });

    it('measures BYTES, not characters', () => {
        // 70 multi-byte characters are under the 76-char line but over the
        // 76-BYTE budget, which is the quantity the encoder actually applies.
        expect(willTakeChunkLane({ actionString: 'é'.repeat(70) }, {})).toBe(true);
    });

    it('is false when there is no action at all (a bare payment)', () => {
        expect(willTakeChunkLane(null, {})).toBe(false);
        expect(willTakeChunkLane({}, {})).toBe(false);
    });

    // The cap is declared in core rather than imported, because pulling the SDK
    // package index into core's graph re-arms  in the MV3 worker build.
    // This is the drift gate that keeps the two honest: the test runs in Node
    // and may import what core may not.
    it('uses the same OP_RETURN budget the SDK pre-flight uses', () => {
        // The constants MODULE, not the package index: by path because
        // xchain-sdk is a dependency of the shells rather than the workspace
        // root, and directly because the index pulls in the EC crypto stack,
        // which does not initialise under jsdom ("ecc library invalid").
        const { ENCODING_LIMITS } = require('../../../../xchain-sdk/src/preflight/constants.js');
        const budget = ENCODING_LIMITS.OP_RETURN;
        expect(willTakeChunkLane({ actionString: 'x'.repeat(budget) }, {})).toBe(false);
        expect(willTakeChunkLane({ actionString: 'x'.repeat(budget + 1) }, {})).toBe(true);
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

describe('assertFeeLane', () => {
    it('passes when the placement matches the encoder\'s choice', () => {
        expect(() => assertFeeLane({ encoding: 'P2SH', deferred: true, hasFeeOutput: true })).not.toThrow();
        expect(() => assertFeeLane({ encoding: 'OP_RETURN', deferred: false, hasFeeOutput: true })).not.toThrow();
    });

    // Both arms exist because a wrong prediction in EITHER direction loses
    // money: one pays on a transaction the indexer does not check, the other
    // never pays at all.
    it('refuses a chunked encoding whose fee stayed on phase 1', () => {
        expect(() => assertFeeLane({ encoding: 'P2WSH', deferred: false, hasFeeOutput: true }))
            .toThrow(FeeLaneMismatchError);
        expect(() => assertFeeLane({ encoding: 'P2WSH', deferred: false, hasFeeOutput: true }))
            .toThrow(/Nothing was signed/);
    });

    it('refuses a single-phase encoding whose fee was deferred to a reveal that will not exist', () => {
        expect(() => assertFeeLane({ encoding: 'OP_RETURN', deferred: true, hasFeeOutput: true }))
            .toThrow(/will not exist/);
    });

    it('is a no-op when the action pays no native fee', () => {
        expect(() => assertFeeLane({ encoding: 'P2SH', deferred: false, hasFeeOutput: false })).not.toThrow();
    });
});
