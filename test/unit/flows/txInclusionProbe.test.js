// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Transaction inclusion probes, read for one fact: which block.

import { describe, it, expect } from 'vitest';
import { inclusionOf, probeTxInclusion } from '../../../packages/core/src/flows/txInclusionProbe.js';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);

describe('inclusionOf', () => {
    it('names the block off encoder and explorer replies, including a data envelope', () => {
        expect(inclusionOf({ block_hash: B, block_height: 123, sync: { committed_height: 125 } }))
            .toEqual({ blockIndex: 123, actionRecorded: false });
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
    const sdkOf = ({
        blocks = {}, transactions = {}, blockCalls = [], txCalls = [], calls = [],
        encoder = true, explorer = true,
    } = {}) => {
        const sdk = {};
        if (encoder) sdk.encoder = {
            getTxBlock: async (txid) => {
                blockCalls.push(txid);
                calls.push(['block', txid]);
                const a = blocks[txid];
                if (a instanceof Error) throw a;
                return a ?? null;
            },
        };
        if (explorer) sdk.getTransaction = async (query, type) => {
            txCalls.push([query, type]);
            calls.push(['explorer', query, type]);
            const a = transactions[query];
            if (a instanceof Error) throw a;
            return a;
        };
        return sdk;
    };

    it('asks the encoder once per distinct hash and skips the explorer on a hit', async () => {
        const blockCalls = [];
        const txCalls = [];
        const out = await probeTxInclusion({
            sdk: sdkOf({
                blocks: { [A]: { block_height: 10 }, [B]: null },
                transactions: { [B]: { block_index: 11 } },
                blockCalls,
                txCalls,
            }),
            txids: [A.toUpperCase(), A, B],
        });
        expect(blockCalls.sort()).toEqual([A, B]);
        expect(txCalls).toEqual([[B, 'tx_hash']]);
        expect(out).toEqual(new Map([
            [A, { blockIndex: 10, actionRecorded: false }],
            [B, { blockIndex: 11, actionRecorded: false }],
        ]));
    });

    it.each([
        ['returns null', null],
        ['fails', new Error('tracker unavailable')],
    ])('falls back to the explorer after getTxBlock %s', async (_label, blockAnswer) => {
        const calls = [];
        const out = await probeTxInclusion({
            sdk: sdkOf({
                blocks: { [A]: blockAnswer },
                transactions: { [A]: { block_index: 11 } },
                calls,
            }),
            txids: [A],
        });
        expect(calls).toEqual([
            ['block', A],
            ['explorer', A, 'tx_hash'],
        ]);
        expect(out).toEqual(new Map([[A, { blockIndex: 11, actionRecorded: false }]]));
    });

    it('swallows failing encoder and explorer lookups without failing the batch', async () => {
        const out = await probeTxInclusion({
            sdk: sdkOf({
                blocks: { [A]: new Error('tracker unavailable'), [B]: null },
                transactions: { [A]: new Error('explorer unavailable'), [B]: { block_index: 11 } },
            }),
            txids: [A, B],
        });
        expect(out).toEqual(new Map([[B, { blockIndex: 11, actionRecorded: false }]]));
    });

    it('answers nothing without a lookup client or without hashes', async () => {
        expect(await probeTxInclusion({ sdk: null, txids: [A] })).toEqual(new Map());
        expect(await probeTxInclusion({ sdk: {}, txids: [A] })).toEqual(new Map());
        expect(await probeTxInclusion({ sdk: sdkOf(), txids: [] })).toEqual(new Map());
    });
});
