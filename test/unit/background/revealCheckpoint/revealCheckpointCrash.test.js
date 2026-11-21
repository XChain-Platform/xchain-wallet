// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueStorageAdapter } from '../../../../packages/extension/src/background/broadcastQueueStorage.js';
import { capOwedSettlementRecords } from '../../../../packages/extension/src/background/broadcastQueueStore.js';
import { signedTxFor, trackerFor } from '../../../helpers/signedTx.js';

const CHAIN = 'litecoin-regtest';
const WALLET = 'w1';
const COMMIT = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const REVEAL = signedTxFor({
    inputs: [{ type: 'p2wpkh', txid: '0002'.repeat(16), vout: 1 }],
    outputs: [{ script: `0014${'dd'.repeat(20)}`, value: 89_000 }],
});

function pendingCollection() {
    const rows = new Map();
    let blocked = false;
    let reportBlocked;
    const blockedUpdate = new Promise((resolve) => { reportBlocked = resolve; });
    const copy = (value) => structuredClone(value);
    return {
        get: async (id) => (rows.has(id) ? copy(rows.get(id)) : null),
        put: async (row) => { rows.set(row.id, copy(row)); },
        delete: async (id) => rows.delete(id),
        list: async () => [...rows.values()].map(copy),
        find: async (id) => (rows.has(id) ? copy(rows.get(id)) : null),
        findBy: async (key, value) => [...rows.values()].filter((row) => row[key] === value).map(copy),
        update: async (id, decide) => {
            if (blocked) {
                reportBlocked();
                return new Promise(() => {});
            }
            const next = decide(rows.has(id) ? copy(rows.get(id)) : null);
            if (next == null) return false;
            rows.set(id, copy(next));
            return true;
        },
        block: () => { blocked = true; },
        unblock: () => { blocked = false; },
        waitForBlockedUpdate: () => blockedUpdate,
    };
}

function sharedStorage(initial) {
    let blob = structuredClone(initial);
    let reached;
    const checkpoint = new Promise((resolve) => { reached = resolve; });
    const adapter = () => createBroadcastQueueStorageAdapter({
        read: async () => ({ ok: true, blob: structuredClone(blob) }),
        write: async (next) => {
            blob = structuredClone(next);
            if (blob.settlements?.some((entry) => entry.op === 'reveal')) reached();
        },
        remove: async () => { blob = null; },
    });
    return { adapter, checkpoint, read: () => structuredClone(blob) };
}

function boot({ pendingTxs, storage, broadcastTx }) {
    const vault = {
        pendingTxs,
        wallets: { list: async () => [{ id: WALLET }], get: async () => ({ id: WALLET, importedKeys: [] }) },
        accounts: { findBy: async () => [] },
        addresses: { list: async () => [] },
        settings: { get: async () => ({}), put: async () => {} },
    };
    const tracker = trackerFor([...COMMIT.prevouts, ...REVEAL.prevouts], networks.regtest);
    const sdk = {
        encoder: { broadcastTx: vi.fn(broadcastTx), getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => ({ id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }), list: () => [] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: storage,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return (type, request) => host.handle({ type, request });
}

describe('two-phase reveal checkpoint durability', () => {
    it('repairs the PendingTx before discard after a checkpoint crash', async () => {
        const pendingTxs = pendingCollection();
        const pair = {
            id: 'q1', chainId: CHAIN, signedTxHex: COMMIT.txHex, txid: 'commit-id',
            summary: 'Deploy', signedAt: 1, pendingTxId: 'p1',
            revealTxHex: REVEAL.txHex, revealTxid: 'reveal-id',
        };
        await pendingTxs.put({
            id: 'p1', chain: 'litecoin', network: 'regtest', status: 'queued',
            txHex: COMMIT.txHex, txid: 'commit-id', revealTxHex: REVEAL.txHex,
            revealTxid: 'reveal-id', createdAt: '2026-01-01T00:00:00.000Z',
        });
        const persisted = sharedStorage({ storageVersion: 1, queues: { [WALLET]: [pair] }, settlements: [] });
        const first = boot({
            pendingTxs,
            storage: persisted.adapter(),
            broadcastTx: async (hex) => {
                if (hex === COMMIT.txHex) pendingTxs.block();
                return { txid: hex === COMMIT.txHex ? 'commit-id' : 'reveal-id' };
            },
        });
        void first('broadcast.queue.broadcast', { walletId: WALLET, id: 'q1' }).catch(() => {});
        await persisted.checkpoint;
        await pendingTxs.waitForBlockedUpdate();

        const crashBlob = persisted.read();
        expect(crashBlob.settlements[0]).toMatchObject({ op: 'reveal', pendingTxId: 'p1' });
        expect(JSON.stringify(crashBlob.settlements)).not.toContain(COMMIT.txHex);
        expect(JSON.stringify(crashBlob.settlements)).not.toContain(REVEAL.txHex);

        pendingTxs.unblock();
        const restarted = boot({ pendingTxs, storage: persisted.adapter(), broadcastTx: async () => ({}) });
        const result = await restarted('broadcast.queue.discard', { walletId: WALLET, id: 'q1' });
        expect(result).toMatchObject({ ok: true, result: { discarded: true } });
        expect(await pendingTxs.get('p1')).toMatchObject({
            status: 'broadcast', txid: 'commit-id', commitLanded: true, commitTxid: 'commit-id',
        });
    });

    it('retains reveal repairs when the ordinary journal reaches its cap', () => {
        const records = [{ id: 'reveal', pendingTxId: 'p0', op: 'reveal' }];
        for (let i = 0; i < 60; i += 1) {
            records.push({ id: `patch-${i}`, pendingTxId: `p${i + 1}`, op: 'patch' });
        }
        const capped = capOwedSettlementRecords(records);
        expect(capped).toHaveLength(50);
        expect(capped[0]).toMatchObject({ id: 'reveal', op: 'reveal' });
        expect(capped.at(-1)).toMatchObject({ id: 'patch-59' });
    });
});
