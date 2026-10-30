// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const WALLET = 'wallet-1';
const CHAIN = 'bitcoin-regtest';
// Real signed bytes whose coin the tracker stand-in lists, since the route
// verifies every signature before it records or broadcasts anything.
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const TX_HEX = SIGNED.txHex;
const TXID = 'signed-txid';

function memCollection() {
    const records = new Map();
    const copy = (value) => JSON.parse(JSON.stringify(value));
    return {
        get: async (id) => (records.has(id) ? copy(records.get(id)) : null),
        put: vi.fn(async (record) => { records.set(record.id, copy(record)); }),
        list: async () => Array.from(records.values()).map(copy),
        delete: async (id) => records.delete(id),
        find: async (id) => (records.has(id) ? copy(records.get(id)) : null),
        findBy: async (key, value) => Array.from(records.values())
            .filter((record) => record[key] === value)
            .map(copy),
    };
}

function makeHost(broadcastTx) {
    const pendingTxs = memCollection();
    const snapshots = [];
    const storage = {
        load: async () => ({}),
        save: vi.fn(async (snapshot) => { snapshots.push(JSON.parse(JSON.stringify(snapshot))); }),
        clear: async () => {},
    };
    const tracker = trackerFor(SIGNED.prevouts, networks.regtest);
    const sdk = {
        encoder: { broadcastTx, getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const host = createBackgroundHost({
        vault: {
            pendingTxs,
            wallets: { list: async () => [{ id: WALLET, name: 'Hardware wallet' }] },
            settings: { get: async () => null, put: async () => {} },
        },
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
        },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: storage,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = (type, request) => host.handle({ type, request });
    const broadcast = () => call('broadcast.signedTx', {
        walletId: WALLET,
        chainId: CHAIN,
        txHex: TX_HEX,
        txid: TXID,
        fromAddress: 'bcrt1qhardware',
    });
    const listQueue = () => call('broadcast.queue.list', { walletId: WALLET });
    return { broadcast, call, listQueue, pendingTxs, snapshots };
}

describe('broadcast.signedTx transient handoff', () => {
    it('keeps signed bytes queued and retryable after a transient node failure', async () => {
        const broadcastTx = vi.fn()
            .mockRejectedValueOnce(new Error('ECONNREFUSED'))
            .mockResolvedValueOnce({ txid: TXID });
        const h = makeHost(broadcastTx);

        const first = await h.broadcast();
        expect(first.ok, JSON.stringify(first.error ?? {})).toBe(true);
        expect(first.result).toMatchObject({ queued: true, broadcast: 'queued', persisted: true });

        const records = await h.pendingTxs.list();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            status: 'queued',
            fromAddress: 'bcrt1qhardware',
            txHex: TX_HEX,
            txid: TXID,
            error: 'ECONNREFUSED',
        });

        const listed = await h.listQueue();
        expect(listed.result).toEqual([
            expect.objectContaining({
                id: first.result.queueId,
                chainId: CHAIN,
                signedTxHex: TX_HEX,
                txid: TXID,
                pendingTxId: records[0].id,
            }),
        ]);
        expect(h.snapshots.at(-1)?.[WALLET]?.[0]).toMatchObject({ signedTxHex: TX_HEX });

        const retry = await h.call('broadcast.queue.broadcast', {
            walletId: WALLET,
            id: first.result.queueId,
        });
        expect(retry.ok, JSON.stringify(retry.error ?? {})).toBe(true);
        expect(retry.result.txid).toBe(TXID);
        expect((await h.pendingTxs.list())[0]).toMatchObject({ status: 'broadcast', txid: TXID, error: null });
        expect((await h.listQueue()).result).toEqual([]);
    });

    it('treats an already-known rejection as delivery without creating a queue entry', async () => {
        const h = makeHost(vi.fn(async () => { throw new Error('txn-already-known'); }));

        const response = await h.broadcast();

        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(response.result).toEqual({ txid: TXID, alreadyOnNetwork: true });
        expect((await h.pendingTxs.list())[0]).toMatchObject({ status: 'broadcast', txid: TXID, error: null });
        expect((await h.listQueue()).result).toEqual([]);
    });

    it('marks a permanent rejection failed and never queues its bytes', async () => {
        const h = makeHost(vi.fn(async () => { throw new Error('bad-txns-inputs-missingorspent'); }));

        const response = await h.broadcast();

        expect(response.ok).toBe(false);
        expect(response.error.name).toBe('BroadcastFailedPermanentError');
        expect((await h.pendingTxs.list())[0]).toMatchObject({
            status: 'failed',
            error: 'bad-txns-inputs-missingorspent',
        });
        expect((await h.listQueue()).result).toEqual([]);
    });
});

describe('broadcast.signedTx with a pasted raw transaction', () => {
    const RAW = TX_HEX;

    it('records the txid derived from the bytes when the caller sends none', async () => {
        const h = makeHost(vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

        const response = await h.call('broadcast.signedTx', { walletId: WALLET, chainId: CHAIN, txHex: RAW });

        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        const [record] = await h.pendingTxs.list();
        expect(record.txid).toMatch(/^[0-9a-f]{64}$/);
        expect(record).toMatchObject({ status: 'queued', fromAddress: 'unknown' });
    });
});
