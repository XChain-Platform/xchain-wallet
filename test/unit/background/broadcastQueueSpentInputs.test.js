// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A queued entry whose coins are no longer unspent. The pre-send signature
// check finds nothing to verify against, which is what a transaction that
// already landed (its reply lost) and a transaction another spend beat both
// look like. The route asks the chain which it was and settles the entry on
// that answer; the bytes themselves are never sent for either.

import { describe, it, expect, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { flows } from '@xchain-wallet/core';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { rawTxid } from '../../../packages/core/src/signers/verifySignedTx.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const CHAIN = 'litecoin-regtest';
const W = 'w1';
const ADDR = 'rltc1qsrc';
const SINGLE = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const SINGLE_TXID = rawTxid(SINGLE.txHex);
const REVEAL = signedTxFor({
    inputs: [{ type: 'p2wpkh', txid: '0002'.repeat(16), vout: 1 }],
    outputs: [{ script: `0014${'dd'.repeat(20)}`, value: 89_000 }],
});
const TAMPERED = signedTxFor({ inputs: [{ type: 'p2wpkh' }], tamper: { input: 0, kind: 'flip' } });

function memCollection() {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

const chainRegistry = {
    get: () => ({ id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }),
    list: () => [],
    chainIdFor: (coin, network) => (coin === 'litecoin' && network === 'regtest' ? CHAIN : null),
};

/**
 * A host over one queued entry. `unspent` lists the coins the tracker still
 * reports (none by default: every input is spent); `reads` are the chain reads
 * the SDK answers with, absent ones are simply missing from the SDK.
 */
async function bootHost({ entry, record, unspent = [], reads = {}, broadcastTx = async () => ({ txid: 'sent' }) }) {
    const pendingTxs = memCollection();
    await pendingTxs.put(record);
    const vault = {
        pendingTxs,
        wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
        accounts: { findBy: async (key, value) => (key === 'walletId' ? [{ id: `acct-${value}`, walletId: value }] : []) },
        addresses: { list: async () => [{ id: 'addr-a', accountId: `acct-${W}`, address: ADDR }] },
        settings: { get: vi.fn(async () => ({})), put: vi.fn(async () => {}) },
    };
    const tracker = trackerFor(unspent, networks.regtest);
    const sdk = {
        encoder: { broadcastTx: vi.fn(broadcastTx), getUTXOs: tracker.getUTXOs, ...(reads.getTxBlock ? { getTxBlock: reads.getTxBlock } : {}) },
        wallet: { getBitcoinNetwork: () => networks.regtest },
        ...(reads.getUnconfirmed ? { getUnconfirmed: reads.getUnconfirmed } : {}),
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({ [W]: [entry] }), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = async () => host.handle({ type: 'broadcast.queue.broadcast', request: { walletId: W, id: entry.id } });
    const list = async () => (await host.handle({ type: 'broadcast.queue.list', request: { walletId: W } })).result;
    return { call, list, pendingTxs, sdk, sent: () => sdk.encoder.broadcastTx.mock.calls.map(([hex]) => hex) };
}

const singleEntry = { id: 'A', chainId: CHAIN, signedTxHex: SINGLE.txHex, txid: SINGLE_TXID, summary: 'Send', signedAt: 1, pendingTxId: 'p1' };
const singleRecord = {
    id: 'p1', chain: 'litecoin', network: 'regtest', fromAddress: ADDR, status: 'queued',
    txHex: SINGLE.txHex, txid: SINGLE_TXID, createdAt: '2026-01-01T00:00:00.000Z',
};
const included = vi.fn(async () => ({ block_height: 7 }));
const notIncluded = () => vi.fn(async () => ({}));

describe('a queued entry whose coins are already spent settles on what the chain says', () => {
    it('settles as delivered, unsent, when the block index holds the transaction', async () => {
        const h = await bootHost({ entry: singleEntry, record: singleRecord, reads: { getTxBlock: included } });

        const res = await h.call();

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(res.result).toMatchObject({ txid: SINGLE_TXID, alreadyOnNetwork: true });
        expect(h.sent()).toEqual([]);
        expect(await h.pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: SINGLE_TXID });
        expect(await h.list()).toEqual([]);
    });

    it('settles as delivered when only the source address mempool lists it', async () => {
        const getUnconfirmed = vi.fn(async () => [{ tx_hash: SINGLE_TXID.toUpperCase() }]);
        const h = await bootHost({ entry: singleEntry, record: singleRecord, reads: { getTxBlock: notIncluded(), getUnconfirmed } });

        const res = await h.call();

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(res.result).toMatchObject({ alreadyOnNetwork: true });
        expect(getUnconfirmed).toHaveBeenCalledWith(expect.any(String));
        expect(h.sent()).toEqual([]);
        expect(await h.pendingTxs.get('p1')).toMatchObject({ status: 'broadcast' });
        expect(await h.list()).toEqual([]);
    });

    it('retires the entry as permanent when the block index and the mempool both answer without it', async () => {
        const h = await bootHost({
            entry: singleEntry,
            record: singleRecord,
            reads: { getTxBlock: notIncluded(), getUnconfirmed: vi.fn(async () => []) },
        });

        const res = await h.call();

        expect(res.ok).toBe(false);
        expect(res.error.name).toBe(flows.BROADCAST_FAILED_PERMANENT_NAME);
        expect(res.error.message).toMatch(/already spent by another transaction/);
        expect(h.sent()).toEqual([]);
        expect(await h.pendingTxs.get('p1')).toMatchObject({ status: 'failed' });
        expect(await h.list()).toEqual([]);
    });

    it('keeps a queued fee-bump replacement while its original still holds the coins in the mempool', async () => {
        const entry = { ...singleEntry, rbfReplacesPendingTxId: 'p0' };
        const h = await bootHost({
            entry,
            record: { ...singleRecord, rbfReplacesPendingTxId: 'p0' },
            reads: { getTxBlock: notIncluded(), getUnconfirmed: vi.fn(async () => [{ tx_hash: 'ab'.repeat(32) }]) },
        });

        const res = await h.call();

        expect(res.ok).toBe(false);
        expect(res.error.name).toBe(flows.BROADCAST_FAILED_TRANSIENT_NAME);
        expect(h.sent()).toEqual([]);
        expect(await h.pendingTxs.get('p1')).toMatchObject({ status: 'queued' });
        expect(await h.list()).toEqual([expect.objectContaining({ id: 'A', retryAttempt: 1, rbfReplacesPendingTxId: 'p0' })]);
    });

    it('backs off instead of retiring when the SDK cannot read the mempool', async () => {
        const h = await bootHost({ entry: singleEntry, record: singleRecord, reads: { getTxBlock: notIncluded() } });

        const res = await h.call();

        expect(res.ok).toBe(false);
        expect(res.error.name).toBe(flows.BROADCAST_FAILED_TRANSIENT_NAME);
        expect(h.sent()).toEqual([]);
        expect(await h.pendingTxs.get('p1')).toMatchObject({ status: 'queued' });
        expect(await h.list()).toEqual([expect.objectContaining({ id: 'A', retryAttempt: 1 })]);
    });

    it('backs off and then refuses an immediate retry when the block read fails', async () => {
        const getTxBlock = vi.fn(async () => { throw new Error('ETIMEDOUT'); });
        const h = await bootHost({
            entry: singleEntry, record: singleRecord, reads: { getTxBlock, getUnconfirmed: vi.fn(async () => []) },
        });

        const first = await h.call();
        expect(first.error.name).toBe(flows.BROADCAST_FAILED_TRANSIENT_NAME);
        const [queued] = await h.list();
        expect(queued).toMatchObject({ id: 'A', retryAttempt: 1 });
        expect(Number.isFinite(queued.nextRetryAt)).toBe(true);

        const second = await h.call();
        expect(second.error.message).toMatch(/Sending is paused/);
        expect(h.sent()).toEqual([]);
    });
});

describe('the spent-input settlement keeps the signature guard', () => {
    it('still refuses tampered bytes whose coins are unspent, and sends nothing', async () => {
        const getTxBlock = vi.fn(async () => ({ block_height: 7 }));
        const entry = { ...singleEntry, signedTxHex: TAMPERED.txHex, txid: rawTxid(TAMPERED.txHex) };
        const h = await bootHost({ entry, record: { ...singleRecord, txHex: TAMPERED.txHex }, unspent: TAMPERED.prevouts, reads: { getTxBlock } });

        const res = await h.call();

        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('SignatureMismatchError');
        expect(getTxBlock).not.toHaveBeenCalled();
        expect(h.sent()).toEqual([]);
        expect(await h.list()).toEqual([expect.objectContaining({ id: 'A' })]);
    });

    it('does not read the chain when the tracker itself fails', async () => {
        const getTxBlock = vi.fn(async () => ({ block_height: 7 }));
        const h = await bootHost({ entry: singleEntry, record: singleRecord, reads: { getTxBlock } });
        h.sdk.encoder.getUTXOs = async () => { throw new Error('tracker down'); };

        const res = await h.call();

        expect(res.error.name).toBe('SignatureMismatchError');
        expect(getTxBlock).not.toHaveBeenCalled();
        expect(h.sent()).toEqual([]);
        expect(await h.list()).toEqual([expect.objectContaining({ id: 'A' })]);
    });

    it('never settles unverifiable bytes as delivered on the strength of an unrelated block answer', async () => {
        const entry = { ...singleEntry, signedTxHex: TAMPERED.txHex, txid: rawTxid(TAMPERED.txHex) };
        const h = await bootHost({
            entry,
            record: { ...singleRecord, txHex: TAMPERED.txHex },
            reads: { getTxBlock: notIncluded(), getUnconfirmed: vi.fn(async () => []) },
        });

        const res = await h.call();

        expect(res.result).toBeUndefined();
        expect(h.sent()).toEqual([]);
    });
});

describe('a two-phase entry whose commit already landed', () => {
    const pair = { ...singleEntry, revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2' };
    const record = { ...singleRecord, revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2' };

    it('sends the reveal once and never the commit', async () => {
        const h = await bootHost({ entry: pair, record, reads: { getTxBlock: included } });

        const res = await h.call();

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(h.sent()).toEqual([REVEAL.txHex]);
        expect(await h.pendingTxs.get('p1')).toMatchObject({
            status: 'broadcast', commitLanded: true, commitTxid: SINGLE_TXID,
        });
        expect(await h.list()).toEqual([]);
    });

    it('keeps the entry as its reveal when the reveal send is refused', async () => {
        const h = await bootHost({
            entry: pair, record, reads: { getTxBlock: included }, broadcastTx: async () => { throw new Error('ETIMEDOUT'); },
        });

        const res = await h.call();

        expect(res.error.name).toBe(flows.BROADCAST_FAILED_TRANSIENT_NAME);
        expect(h.sent()).toEqual([REVEAL.txHex]);
        expect(await h.list()).toEqual([expect.objectContaining({ id: 'A', signedTxHex: REVEAL.txHex, commitLanded: true })]);
    });
});
