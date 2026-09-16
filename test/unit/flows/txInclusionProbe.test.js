// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer's transaction record, read for one fact: which block.

import { describe, it, expect } from 'vitest';
import { inclusionOf, probeTxInclusion } from '../../../packages/core/src/flows/txInclusionProbe.js';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);

describe('inclusionOf', () => {
    it('names the block off the bare record and off a data envelope', () => {
        expect(inclusionOf({ tx_hash: A, block_index: 67881853, actions: [], tx_data: 'COINPAY|0|648' }))
            .toEqual({ blockIndex: 67881853, actionRecorded: false });
        // The deployed explorer serves the block as a string.
        expect(inclusionOf({ data: { block_index: '7707' } })).toEqual({ blockIndex: 7707, actionRecorded: false });
    });

    it('says when the service holds a valid action for it, and not for a rejected one', () => {
        expect(inclusionOf({ block_index: 67882092, actions: [{ action_index: '667', action: 'COINPAY', status: 'valid' }] }))
            .toEqual({ blockIndex: 67882092, actionRecorded: true });
        expect(inclusionOf({ block_index: 5, actions: [{ action: 'COINPAY', status: 'invalid' }, null] }))
            .toEqual({ blockIndex: 5, actionRecorded: false });
        expect(inclusionOf({ block_index: 5, actions: 'none' })).toEqual({ blockIndex: 5, actionRecorded: false });
    });

    it('is null for the empty record the explorer returns for a hash it never decoded, and for anything else', () => {
        expect(inclusionOf({ actions: [], tx_data: null })).toBeNull();
        expect(inclusionOf({ block_index: 0 })).toBeNull();
        expect(inclusionOf({ block_index: -3 })).toBeNull();
        expect(inclusionOf({ block_index: 'soon' })).toBeNull();
        expect(inclusionOf(null)).toBeNull();
        expect(inclusionOf('nope')).toBeNull();
        expect(inclusionOf({ data: [] })).toBeNull();
    });
});

describe('probeTxInclusion', () => {
    const sdkOf = (answers, calls = []) => ({
        getTransaction: async (query, type) => {
            calls.push([query, type]);
            const a = answers[query];
            if (a instanceof Error) throw a;
            return a;
        },
    });

    it('asks once per distinct hash, by hash, and returns only the ones in a block', async () => {
        const calls = [];
        const out = await probeTxInclusion({
            sdk: sdkOf({ [A]: { block_index: 10 }, [B]: { actions: [] } }, calls),
            txids: [A.toUpperCase(), A, B],
        });
        expect(calls.map(([q, t]) => `${q}:${t}`).sort()).toEqual([`${A}:tx_hash`, `${B}:tx_hash`]);
        expect(out).toEqual(new Map([[A, { blockIndex: 10, actionRecorded: false }]]));
    });

    it('swallows a failing lookup and answers nothing for it, without failing the batch', async () => {
        const out = await probeTxInclusion({
            sdk: sdkOf({ [A]: new Error('ECONNRESET'), [B]: { block_index: 11 } }),
            txids: [A, B],
        });
        expect(out).toEqual(new Map([[B, { blockIndex: 11, actionRecorded: false }]]));
    });

    it('answers nothing without an explorer client or without hashes', async () => {
        expect(await probeTxInclusion({ sdk: null, txids: [A] })).toEqual(new Map());
        expect(await probeTxInclusion({ sdk: {}, txids: [A] })).toEqual(new Map());
        expect(await probeTxInclusion({ sdk: sdkOf({}), txids: [] })).toEqual(new Map());
    });
});
