// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';

const malformedResult = {
    deltas: [],
    sideEffects: [],
    notes: ['Balance changes could not be simulated because the transaction data is malformed.'],
};

describe('simulateAction low-coverage branches', () => {
    it('rejects a non-array balance collection', () => {
        expect(simulateAction({ action: 'SEND', balances: {} })).toEqual(malformedResult);
    });

    it.each(['2', '3'])('omits the ISSUE side effect for version %s without a ticker', (version) => {
        const result = simulateAction({
            action: 'ISSUE',
            params: { VERSION: version },
            feeEstimate: '0',
        });

        expect(result.sideEffects).toEqual([]);
    });

    it('omits a protocol fee that has no explicit or inferred ticker', () => {
        const result = simulateAction({
            action: 'FUTURE_ACTION',
            params: {},
            protocolFee: { amount: '1' },
        });

        expect(result.deltas).toEqual([]);
        expect(result.notes).toHaveLength(1);
    });
});
