// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import {
    createBroadcastQueueStore,
    refreshBroadcastQueueStore,
} from '../../../packages/extension/src/background/broadcastQueueStore.js';

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

const settle = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

function gatedStorage(gates) {
    let reads = 0;
    return {
        get reads() { return reads; },
        async load() {
            const gate = gates[reads];
            reads += 1;
            return gate ? gate.promise : {};
        },
        async loadSettlements() { return []; },
        async save() {},
        async saveSettlements() {},
        async clear() {},
    };
}

function build(storage) {
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
    return { store, engine };
}

describe('broadcast queue load promise ownership', () => {
    it('does not let failed engine cleanup clear a lease refresh in flight', async () => {
        const first = deferred();
        const refreshRead = deferred();
        const storage = gatedStorage([first, refreshRead]);
        const { store, engine } = build(storage);

        const initial = engine.ensureQueueLoaded();
        const refresh = refreshBroadcastQueueStore(store);
        const overlapping = engine.ensureQueueLoaded();
        first.resolve(null);
        await settle();
        expect(storage.reads).toBe(2);
        expect(store.loadPromise).not.toBeNull();

        const joined = engine.ensureQueueLoaded();
        await settle();
        expect(storage.reads).toBe(2);
        refreshRead.resolve({});
        await Promise.all([initial, refresh, overlapping, joined]);
        expect(store.loaded).toBe(true);
    });

    it('does not let an older failed refresh clear a newer refresh', async () => {
        const previous = deferred();
        const olderRead = deferred();
        const newerRead = deferred();
        const storage = gatedStorage([olderRead, newerRead]);
        const { store } = build(storage);
        store.loadPromise = previous.promise;

        const older = refreshBroadcastQueueStore(store);
        const newer = refreshBroadcastQueueStore(store);
        previous.resolve(false);
        await settle();
        expect(storage.reads).toBe(2);

        const active = store.loadPromise;
        olderRead.resolve(null);
        await settle();
        expect(store.loadPromise).toBe(active);
        newerRead.resolve({});
        await expect(older).resolves.toBe(false);
        await expect(newer).resolves.toBe(true);
    });
});
