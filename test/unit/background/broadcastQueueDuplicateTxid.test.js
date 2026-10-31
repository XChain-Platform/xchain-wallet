// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Signing the same payment again after an ambiguous broadcast produces the same
// bytes, so the same txid, under a second PendingTx. The queue lists one row
// for one transaction.

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const CHAIN = 'bitcoin-regtest';

function memStorage() {
    let blob = {};
    return {
        async load() { return JSON.parse(JSON.stringify(blob)); },
        async loadSettlements() { return []; },
        async save(snapshot) { blob = JSON.parse(JSON.stringify(snapshot)); },
        async saveSettlements() {},
        async clear() { blob = {}; },
        read: () => JSON.parse(JSON.stringify(blob)),
    };
}

async function boot(storage = memStorage(), importedAddressIdsFor = async () => new Set()) {
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor,
        discardQueuedBroadcast: async () => {},
    });
    await engine.ensureQueueLoaded();
    return { storage, engine };
}

const entry = (extra = {}) => ({
    chainId: CHAIN, signedTxHex: 'hex-a', txid: 'tx-a', summary: 'Send', signedAt: 1, pendingTxId: 'p1', ...extra,
});

describe('broadcast queue rows are unique by txid', () => {
    it('keeps one row when an identical payment is signed again under a new PendingTx', async () => {
        const { storage, engine } = await boot();
        const hook = engine.enqueueOnBroadcastFailure(W);
        await hook(entry({ pendingTxId: 'p1' }));
        await hook(entry({ pendingTxId: 'p2', signedAt: 2 }));

        expect(engine.getQueue(W)).toHaveLength(1);
        expect(engine.getQueue(W)[0]).toMatchObject({
            txid: 'tx-a', pendingTxId: 'p1', siblingPendingTxIds: ['p2'],
        });
        expect(storage.read()[W]).toHaveLength(1);
        expect(storage.read()[W][0]).not.toHaveProperty('siblingPendingTxIds');
    });

    it('settles every PendingTx record attached to the deduplicated row', async () => {
        const { engine } = await boot();
        const hook = engine.enqueueOnBroadcastFailure(W);
        await hook(entry({ pendingTxId: 'p1' }));
        await hook(entry({ pendingTxId: 'p2', signedAt: 2 }));
        const records = new Map([
            ['p1', { id: 'p1', status: 'queued' }],
            ['p2', { id: 'p2', status: 'queued' }],
        ]);
        const vault = {
            pendingTxs: {
                get: async (id) => records.get(id) ?? null,
                put: async (record) => { records.set(record.id, record); },
            },
        };

        await expect(engine.settleQueuedPendingTx(
            vault,
            engine.getQueue(W)[0],
            { status: 'broadcast', txid: 'tx-a' },
        )).resolves.toBe('settled');
        expect([...records.values()]).toEqual([
            { id: 'p1', status: 'broadcast', txid: 'tx-a' },
            { id: 'p2', status: 'broadcast', txid: 'tx-a' },
        ]);
    });

    it('does not restore an alias PendingTx as a second row after restart', async () => {
        const storage = memStorage();
        const first = await boot(storage);
        await first.engine.enqueueOnBroadcastFailure(W)(entry({ pendingTxId: 'p1' }));
        await first.engine.enqueueOnBroadcastFailure(W)(entry({ pendingTxId: 'p2' }));
        const second = await boot(storage, async () => new Set(['addr-1']));
        const vault = {
            accounts: { findBy: async () => [] },
            addresses: { list: async () => [{ id: 'addr-1', address: 'addr-1' }] },
            pendingTxs: {
                findBy: async (field, value) => (field === 'status' && value === 'queued' ? [{
                    id: 'p2', status: 'queued', chain: 'bitcoin', network: 'regtest',
                    fromAddress: 'addr-1', txHex: 'hex-a', txid: 'tx-a', createdAt: '2026-01-01',
                }] : []),
            },
        };

        await second.engine.restoreQueueFromVault(vault, {
            chainIdFor: () => CHAIN,
        }, W);

        expect(second.engine.getQueue(W)).toHaveLength(1);
        expect(second.engine.getQueue(W)[0].siblingPendingTxIds).toEqual(['p2']);
    });

    it('keeps the extra PendingTx id through a queue restart', async () => {
        const storage = memStorage();
        const first = await boot(storage);
        await first.engine.enqueueOnBroadcastFailure(W)(entry({ pendingTxId: 'p1' }));
        await first.engine.enqueueOnBroadcastFailure(W)(entry({ pendingTxId: 'p2' }));

        const restarted = await boot(storage);
        expect(restarted.engine.getQueue(W)[0]).not.toHaveProperty('siblingPendingTxIds');
        await restarted.engine.enqueueOnBroadcastFailure(W)(entry({ pendingTxId: 'p2' }));

        expect(restarted.engine.getQueue(W)).toEqual([expect.objectContaining({
            pendingTxId: 'p1', siblingPendingTxIds: ['p2'],
        })]);
    });

    it('ignores sibling PendingTx ids supplied by a caller', async () => {
        const { engine } = await boot();

        engine.pushQueueEntry(W, entry({ siblingPendingTxIds: ['unrelated'] }));

        expect(engine.getQueue(W)[0]).not.toHaveProperty('siblingPendingTxIds');
    });

    it('matches on the txid when the second signature differs only in witness bytes', async () => {
        const { engine } = await boot();
        const hook = engine.enqueueOnBroadcastFailure(W);
        await hook(entry());
        await hook(entry({ pendingTxId: 'p2', signedTxHex: 'hex-a-witness-2' }));

        expect(engine.getQueue(W)).toHaveLength(1);
        expect(engine.getQueue(W)[0].siblingPendingTxIds).toEqual(['p2']);
    });

    it('keeps two rows for two different transactions', async () => {
        const { engine } = await boot();
        const hook = engine.enqueueOnBroadcastFailure(W);
        await hook(entry());
        await hook(entry({ pendingTxId: 'p2', signedTxHex: 'hex-b', txid: 'tx-b' }));

        expect(engine.getQueue(W).map((e) => e.txid)).toEqual(['tx-a', 'tx-b']);
    });

    it('keeps the same txid on another chain as its own row', async () => {
        const { engine } = await boot();
        const hook = engine.enqueueOnBroadcastFailure(W);
        await hook(entry());
        await hook(entry({ pendingTxId: 'p2', chainId: 'litecoin-regtest' }));

        expect(engine.getQueue(W)).toHaveLength(2);
    });
});
