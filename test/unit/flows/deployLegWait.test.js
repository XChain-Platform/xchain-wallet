// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The chain read behind a chunked deploy's indexer patience. A "dropped"
// verdict ends the run and invites a re-send, so it must only come from two
// reads that both answered; every failed or missing read is "unknown".

import { describe, it, expect, vi } from 'vitest';
import {
    legChainStatus,
    isIndexerTimeout,
    legMayBeOnChain,
    legNotIndexedError,
    indexerWaitMessage,
    spentInputsVerdict,
} from '../../../packages/core/src/flows/deployLegWait.js';

const TX = 'fb246c85'.padEnd(64, '0');
const ADDR = 'n-source';

describe('legChainStatus', () => {
    it('is confirmed when the tracker places the transaction in a block', async () => {
        const sdk = { encoder: { getTxBlock: vi.fn(async () => ({ block_hash: 'h', block_height: 67937853 })) } };
        expect(await legChainStatus({ sdk, txid: TX, address: ADDR })).toBe('confirmed');
    });

    it('is mempool when the change output is unconfirmed at the source address', async () => {
        const sdk = { encoder: {
            getTxBlock: vi.fn(async () => null),
            getUTXOs: vi.fn(async () => ({ utxos: [{ txid: TX.toUpperCase(), confirmations: 0 }] })),
        } };
        expect(await legChainStatus({ sdk, txid: TX, address: ADDR })).toBe('mempool');
    });

    it('is mempool from the explorer rows when change was rotated to another address', async () => {
        const sdk = {
            encoder: { getTxBlock: vi.fn(async () => null), getUTXOs: vi.fn(async () => ({ utxos: [] })) },
            getUnconfirmed: vi.fn(async () => [{ tx_hash: TX, source: ADDR }]),
        };
        expect(await legChainStatus({ sdk, txid: TX, address: ADDR })).toBe('mempool');
    });

    it('is dropped only when the block index and a mempool read both answered empty', async () => {
        const sdk = { encoder: { getTxBlock: vi.fn(async () => null), getUTXOs: vi.fn(async () => []) } };
        expect(await legChainStatus({ sdk, txid: TX, address: ADDR })).toBe('dropped');
    });

    it('is unknown, never dropped, when the block read fails', async () => {
        const sdk = { encoder: {
            getTxBlock: vi.fn(async () => { throw new Error('tracker lagging'); }),
            getUTXOs: vi.fn(async () => []),
        } };
        expect(await legChainStatus({ sdk, txid: TX, address: ADDR })).toBe('unknown');
    });

    it('is unknown when there is no block read to rule a confirmation out', async () => {
        const sdk = { encoder: { getUTXOs: vi.fn(async () => []) } };
        expect(await legChainStatus({ sdk, txid: TX, address: ADDR })).toBe('unknown');
    });

    it('is null when the SDK offers no chain read at all', async () => {
        expect(await legChainStatus({ sdk: {}, txid: TX, address: ADDR })).toBeNull();
    });
});

describe('leg wait errors', () => {
    it('recognises the SDK timeout by code and by its message', () => {
        expect(isIndexerTimeout({ code: 'CONFIRMATION_TIMEOUT' })).toBe(true);
        expect(isIndexerTimeout(new Error(`Transaction ${TX} was not indexed within 120000ms. x`))).toBe(true);
        expect(isIndexerTimeout({ code: 'ACTION_REJECTED', message: 'invalid' })).toBe(false);
    });

    it('treats every case but a dropped leg as possibly on chain', () => {
        const base = { legLabel: 'Chunk 1 of 2', txid: TX, patienceMs: 900000, isChunk: true };
        for (const chainState of ['confirmed', 'mempool', 'unknown']) {
            expect(legMayBeOnChain(legNotIndexedError({ ...base, chainState }))).toBe(true);
        }
        expect(legMayBeOnChain(legNotIndexedError({ ...base, chainState: 'dropped' }))).toBe(false);
        expect(legMayBeOnChain(new Error('other'))).toBe(false);
    });

    it('never invites a re-send unless the leg was dropped', () => {
        const base = { legLabel: 'Chunk 1 of 2', txid: TX, patienceMs: 900000, isChunk: true };
        for (const chainState of ['confirmed', 'mempool', 'unknown']) {
            expect(legNotIndexedError({ ...base, chainState }).message).not.toMatch(/send this chunk again/);
        }
        expect(legNotIndexedError({ ...base, chainState: 'dropped' }).message).toMatch(/send this chunk again/);
    });
});

describe('indexerWaitMessage', () => {
    it('says a confirmed chunk is waiting for the indexer', () => {
        expect(indexerWaitMessage({ leg: 1, total: 4, chainState: 'confirmed' })).toBe(
            'Chunk 2 of 4 confirmed on chain; waiting for the service to process it (this can take several minutes on this network).',
        );
    });

    it('names the assembling transaction and the mempool case', () => {
        expect(indexerWaitMessage({ leg: null, total: 4, chainState: 'confirmed' }))
            .toMatch(/^The assembling transaction is confirmed on chain; waiting for the service/);
        expect(indexerWaitMessage({ leg: 0, total: 4, chainState: 'mempool' }))
            .toBe('Chunk 1 of 4 is waiting on the network to confirm it, then for the service to process it.');
    });

    it('keeps backend jargon out of wait and timeout copy', () => {
        const base = { legLabel: 'Chunk 1 of 2', txid: TX, patienceMs: 900000, isChunk: true };
        for (const chainState of ['confirmed', 'mempool', 'dropped', 'unknown']) {
            expect(legNotIndexedError({ ...base, chainState }).message).not.toMatch(/\bindex(?:er|ed)?\b/i);
            expect(indexerWaitMessage({ leg: 0, total: 2, chainState })).not.toMatch(/\bindex(?:er|ed)?\b/i);
        }
        expect(indexerWaitMessage({ leg: null, total: 2, chainState: 'confirmed' }))
            .not.toMatch(/\bindex(?:er|ed)?\b/i);
    });

    it('is null with no wait in progress', () => {
        expect(indexerWaitMessage(null)).toBeNull();
    });
});

describe('spentInputsVerdict', () => {
    const block = (res) => vi.fn(async () => res);
    const verdict = (sdk) => spentInputsVerdict({ sdk, txid: TX, address: ADDR });

    it('is landed when the block index holds the transaction', async () => {
        expect(await verdict({ encoder: { getTxBlock: block({ block_height: 9 }) } })).toBe('landed');
    });

    it('is landed when the source address mempool lists it, whatever its change paid', async () => {
        const sdk = {
            encoder: { getTxBlock: block({}), getUTXOs: vi.fn(async () => []) },
            getUnconfirmed: vi.fn(async () => [{ tx_hash: TX.toUpperCase() }]),
        };
        expect(await verdict(sdk)).toBe('landed');
    });

    it('is a conflict only when the block index and the address mempool both answered without it', async () => {
        const sdk = { encoder: { getTxBlock: block({}) }, getUnconfirmed: vi.fn(async () => []) };
        expect(await verdict(sdk)).toBe('conflict');
    });

    it('is unknown while the address mempool holds another transaction, as a fee-bump original does', async () => {
        const sdk = { encoder: { getTxBlock: block({}) }, getUnconfirmed: vi.fn(async () => [{ tx_hash: 'original' }]) };
        expect(await verdict(sdk)).toBe('unknown');
    });

    it('is unknown, never a conflict, when the tracker answered but the mempool cannot be read', async () => {
        const sdk = { encoder: { getTxBlock: block({}), getUTXOs: vi.fn(async () => []) } };
        expect(await verdict(sdk)).toBe('unknown');
    });

    it('is unknown when the mempool read fails or the block read fails', async () => {
        const failing = vi.fn(async () => { throw new Error('down'); });
        expect(await verdict({ encoder: { getTxBlock: block({}) }, getUnconfirmed: failing })).toBe('unknown');
        expect(await verdict({ encoder: { getTxBlock: failing }, getUnconfirmed: vi.fn(async () => []) })).toBe('unknown');
    });

    it('is unknown when the SDK offers no chain read at all', async () => {
        expect(await verdict({})).toBe('unknown');
    });
});
