// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A wallet removed while the queue read fails, with the worker evicted before
// the read recovers, stays removed on the next boot. The prune set lives in
// memory, so a second process needs the durable ledger to learn of the removal.
// The second case is the negative control: the same sequence with no ledger.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';
import { createBroadcastQueueStore, sealBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const CHAIN = 'bitcoin-regtest';
const KEY = 'xchain.broadcastQueue';
const LEDGER_KEY = `xchain.broadcastQueue.pruned.${'w-gone'}`;
const KEPT = 'w-kept';
const GONE = 'w-gone';

const queued = (id) => ({ id, chainId: CHAIN, signedTxHex: `hex-${id}`, summary: id, signedAt: 1 });

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((v) => structuredClone(v)),
        delete: async (id) => m.delete(id),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map((v2) => structuredClone(v2)),
    };
}

async function removableVault() {
    const wallets = memCollection();
    await wallets.put({ id: KEPT, importedKeys: [] });
    await wallets.put({ id: GONE, importedKeys: [] });
    return {
        wallets,
        accounts: memCollection(),
        addresses: memCollection(),
        pendingTxs: memCollection(),
        pendingAirdrops: memCollection(),
        multisigSigningSessions: memCollection(),
        watchlistEntries: memCollection(),
        priceAlerts: memCollection(),
        signers: memCollection(),
        settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
    };
}

/** chrome.storage.local over a shared object; reads fail while `down.reads` is set. */
function fakeChrome(initial) {
    const store = structuredClone(initial);
    const down = { reads: false };
    return {
        store,
        down,
        api: {
            runtime: {},
            storage: {
                local: {
                    get: (key, cb) => (down.reads ? cb(undefined) : cb(key === null ? structuredClone(store) : { [key]: structuredClone(store[key]) })),
                    set: (obj, cb) => { Object.assign(store, structuredClone(obj)); cb(); },
                    remove: (key, cb) => { delete store[key]; cb(); },
                },
            },
        },
    };
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

async function boot(vault, prunedLedger) {
    const storage = createBroadcastQueueStorage();
    const broadcastQueueStore = prunedLedger === undefined
        ? createBroadcastQueueStore({ storage })
        : createBroadcastQueueStore({ storage, prunedLedger });
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }), list: () => [] },
        sdkRegistry: { get: () => ({ encoder: {} }), for: () => ({ encoder: {} }) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: storage,
        broadcastQueueStore,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = (type, request) => host.handle({ type, request });
    return { host, call, broadcastQueueStore };
}

async function removeThenEvictThenBoot({ prunedLedger }) {
    const fake = fakeChrome({ [KEY]: { queues: { [GONE]: [queued('G')], [KEPT]: [queued('K')] } } });
    const prior = globalThis.chrome;
    globalThis.chrome = fake.api;
    try {
        const vault = await removableVault();
        fake.down.reads = true;
        const first = await boot(vault, prunedLedger);
        await first.call('wallet.remove', { walletId: GONE });
        await settle();

        fake.down.reads = false;
        const second = await boot(vault, prunedLedger);
        const gone = await second.call('broadcast.queue.list', { walletId: GONE });
        const kept = await second.call('broadcast.queue.list', { walletId: KEPT });
        await settle();
        return { fake, gone: gone.result, kept: kept.result };
    } finally {
        if (prior === undefined) delete globalThis.chrome;
        else globalThis.chrome = prior;
    }
}

describe('a removed wallet does not resurrect after a worker eviction', () => {
    it('keeps the wallet out of the next boot and out of the blob', async () => {
        const { fake, gone, kept } = await removeThenEvictThenBoot({ prunedLedger: undefined });
        expect(gone).toEqual([]);
        expect(kept.map((e) => e.signedTxHex)).toEqual(['hex-K']);
        expect(Object.keys(fake.store[KEY].queues)).toEqual([KEPT]);
        expect(fake.store[LEDGER_KEY]).toBeUndefined();
    });

    it('resurrects the wallet when no ledger carries the removal across the eviction', async () => {
        const { fake, gone } = await removeThenEvictThenBoot({ prunedLedger: null });
        expect(gone.map((e) => e.signedTxHex)).toEqual(['hex-G']);
        expect(Object.keys(fake.store[KEY].queues).sort()).toEqual([GONE, KEPT]);
    });

    it('fails closed while the ledger itself is unreadable', async () => {
        const fake = fakeChrome({ [KEY]: { queues: { [GONE]: [queued('G')] } }, [LEDGER_KEY]: 1 });
        const prior = globalThis.chrome;
        globalThis.chrome = fake.api;
        try {
            const realGet = fake.api.storage.local.get;
            fake.api.storage.local.get = (key, cb) => (key === null ? cb(undefined) : realGet(key, cb));
            const { call } = await boot(await removableVault());
            expect((await call('broadcast.queue.list', { walletId: GONE })).result).toEqual([]);
            expect(fake.store[KEY].queues[GONE]).toBeDefined();
        } finally {
            if (prior === undefined) delete globalThis.chrome;
            else globalThis.chrome = prior;
        }
    });

    it('erases the ledger when the store is sealed', async () => {
        const fake = fakeChrome({ [LEDGER_KEY]: 1 });
        const prior = globalThis.chrome;
        globalThis.chrome = fake.api;
        try {
            await sealBroadcastQueueStore(createBroadcastQueueStore({ storage: createBroadcastQueueStorage() }));
            await settle();
            expect(fake.store[LEDGER_KEY]).toBeUndefined();
        } finally {
            if (prior === undefined) delete globalThis.chrome;
            else globalThis.chrome = prior;
        }
    });
});
