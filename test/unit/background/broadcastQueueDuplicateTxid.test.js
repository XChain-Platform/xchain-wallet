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

async function boot() {
    const storage = memStorage();
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
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
        expect(engine.getQueue(W)[0]).toMatchObject({ txid: 'tx-a', pendingTxId: 'p1' });
        expect(storage.read()[W]).toHaveLength(1);
    });

    it('matches on the txid when the second signature differs only in witness bytes', async () => {
        const { engine } = await boot();
        const hook = engine.enqueueOnBroadcastFailure(W);
        await hook(entry());
        await hook(entry({ pendingTxId: 'p2', signedTxHex: 'hex-a-witness-2' }));

        expect(engine.getQueue(W)).toHaveLength(1);
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
