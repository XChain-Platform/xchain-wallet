// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createFakeMultipartChain } from '../../helpers/multipartFakeChain.js';

function piece(txid, state = 'mempool') {
    return {
        kind: 'part', source: 'alice', fileHash: 'hash', partIndex: 0,
        rawData: Uint8Array.of(1), txid, state,
    };
}

describe('fake multipart chain mempool metrics', () => {
    it('tracks the current count and lifetime high-water mark', () => {
        const chain = createFakeMultipartChain();
        for (let index = 0; index < 5; index += 1) {
            chain.addPiece(piece(`initial-${index}`));
        }
        expect([chain.mempoolCount(), chain.mempoolHighWater()]).toEqual([5, 5]);

        chain.mine();
        expect([chain.mempoolCount(), chain.mempoolHighWater()]).toEqual([0, 5]);

        const later = Array.from({ length: 3 }, (_, index) =>
            chain.addPiece(piece(`later-${index}`)));
        expect([chain.mempoolCount(), chain.mempoolHighWater()]).toEqual([3, 5]);

        chain.drop(later[0].txid);
        expect([chain.mempoolCount(), chain.mempoolHighWater()]).toEqual([2, 5]);
        chain.markUnknown(later[1].txid);
        expect([chain.mempoolCount(), chain.mempoolHighWater()]).toEqual([1, 5]);

        chain.addPiece(piece('confirmed', 'confirmed'));
        expect([chain.mempoolCount(), chain.mempoolHighWater()]).toEqual([1, 5]);
        expect(chain.calls.slice(-2)).toEqual([
            { method: 'mempoolCount', args: [] },
            { method: 'mempoolHighWater', args: [] },
        ]);
    });
});
