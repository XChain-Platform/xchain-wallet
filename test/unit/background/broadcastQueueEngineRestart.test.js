// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Restart invariant of the queue engine, driven without the host: for a seeded
// random run of enqueues, discards, wallet prunes and journal records over a
// storage adapter, a fresh store and engine over the same adapter reads back
// exactly the state the first one held when every write landed, and never more
// than that when writes were refused.

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function memStorage() {
    let blob = {};
    let owed = [];
    const adapter = {
        refuseSaves: false,
        saves: 0,
        async load() { return JSON.parse(JSON.stringify(blob)); },
        async loadSettlements() { return JSON.parse(JSON.stringify(owed)); },
        async save(snapshot) {
            if (adapter.refuseSaves) throw new Error('refused');
            adapter.saves += 1;
            blob = JSON.parse(JSON.stringify(snapshot));
        },
        async saveSettlements(next) {
            if (adapter.refuseSaves) throw new Error('refused');
            owed = JSON.parse(JSON.stringify(next));
        },
        async clear() { blob = {}; owed = []; },
    };
    return adapter;
}

function boot(storage) {
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
    return { store, engine };
}

const view = (store) => ({
    queues: Object.fromEntries(
        [...store.queues.entries()].filter(([, v]) => v.length > 0).sort(([a], [b]) => a.localeCompare(b)),
    ),
    owed: store.owed.map(({ id, walletId, pendingTxId, op, patch }) => ({ id, walletId, pendingTxId, op, patch })),
});

const WALLETS = ['w1', 'w2', 'w3'];

async function run(seed, steps) {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const storage = memStorage();
    const { store, engine } = boot(storage);
    await engine.ensureQueueLoaded();
    let n = 0;
    for (let i = 0; i < steps; i += 1) {
        const roll = rand();
        const walletId = pick(WALLETS);
        if (roll < 0.5) {
            n += 1;
            engine.pushQueueEntry(walletId, {
                chainId: 'c1',
                signedTxHex: `hex-${seed}-${n}`,
                pendingTxId: rand() < 0.5 ? `p-${seed}-${n}` : undefined,
                adsCommit: rand() < 0.3 ? { chainId: 'c1', donationIncluded: rand() < 0.5 } : null,
            });
        } else if (roll < 0.7) {
            const q = engine.getQueue(walletId);
            if (q.length > 0) q.splice(Math.floor(rand() * q.length), 1);
            await engine.persistQueue();
        } else if (roll < 0.85) {
            await engine.pruneWalletFromQueue(walletId);
        } else {
            engine.recordOwedSettlement(walletId, `o-${seed}-${i}`, 'patch', { status: 'failed' });
        }
        await new Promise((r) => setTimeout(r, 0));
    }
    await engine.persistQueue();
    await engine.persistOwedSettlements();
    return { storage, store };
}

describe('broadcast queue engine restart invariant', () => {
    for (const seed of [1, 7, 42, 1009, 31337, 20260101]) {
        it(`a restart reads back what was held (seed ${seed})`, async () => {
            const { storage, store } = await run(seed, 60);
            const before = view(store);
            const next = boot(storage);
            await next.engine.ensureQueueLoaded();
            const after = view(next.store);
            expect(after.queues).toEqual(before.queues);
            expect(after.owed).toEqual(before.owed);
        });
    }

    it('a restart over refused writes never invents entries the first run did not hold', async () => {
        const storage = memStorage();
        const first = boot(storage);
        await first.engine.ensureQueueLoaded();
        first.engine.pushQueueEntry('w1', { chainId: 'c1', signedTxHex: 'kept' });
        await first.engine.persistQueue();
        storage.refuseSaves = true;
        first.engine.pushQueueEntry('w1', { chainId: 'c1', signedTxHex: 'lost' });
        expect(await first.engine.persistQueue()).toBe(false);
        const next = boot(storage);
        await next.engine.ensureQueueLoaded();
        expect(next.engine.getQueue('w1').map((e) => e.signedTxHex)).toEqual(['kept']);
    });

    it('an unreadable store keeps the load un-latched and writes nothing', async () => {
        const storage = memStorage();
        storage.load = async () => null;
        const { store, engine } = boot(storage);
        engine.pushQueueEntry('w1', { chainId: 'c1', signedTxHex: 'held' });
        await engine.ensureQueueLoaded();
        expect(store.loaded).toBe(false);
        expect(await engine.persistQueue()).toBe(false);
        expect(storage.saves).toBe(0);
    });
});
