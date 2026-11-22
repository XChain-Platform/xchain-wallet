// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An entry this store removed while its writes were refused stays removed when
// storage recovers. A web lease reload whose read fails leaves the live arrays
// in place with `loaded` false, so a Discard still splices the entry while its
// save is refused and the stored key keeps it. Neither recovery path (the
// engine's rehydrate merge or a later lease reload) may fold that stored copy
// back: a renderer entry has no PendingTx to retire it, so the user would be
// offered signed bytes they discarded.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBroadcastQueueEngine } from '../../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStorage } from '../../../../packages/extension/src/background/broadcastQueueStorage.js';
import {
    createBroadcastQueueStore,
    refreshBroadcastQueueStore,
} from '../../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const KEY = 'xchain.broadcastQueue';
const entry = (hex) => ({ chainId: 'bitcoin-regtest', signedTxHex: hex });
const hexes = (list) => (list ?? []).map((e) => e.signedTxHex).sort();

function stubLocalStorage() {
    const items = new Map();
    const faults = { refuseWrites: false, failReads: false };
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('localStorage', {
        getItem(k) {
            if (faults.failReads) throw new Error('storage unreachable');
            return items.has(k) ? items.get(k) : null;
        },
        setItem(k, v) {
            if (faults.refuseWrites) throw new Error('QuotaExceededError');
            items.set(k, String(v));
        },
        removeItem(k) { items.delete(k); },
        key: (i) => [...items.keys()][i] ?? null,
        get length() { return items.size; },
    });
    return {
        faults,
        blob: () => JSON.parse(items.get(KEY) ?? '{"queues":{},"settlements":[]}'),
        writeBlob: (blob) => items.set(KEY, JSON.stringify(blob)),
    };
}

async function loadedTab(...hexList) {
    const store = createBroadcastQueueStore({ storage: createBroadcastQueueStorage(), prunedLedger: null });
    const queue = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
    await queue.ensureQueueLoaded();
    const pushed = hexList.map((hex) => queue.pushQueueEntry(W, entry(hex)));
    expect(await queue.persistQueue()).toBe(true);
    return { store, queue, pushed };
}

// The discard route's own sequence: find by id, splice the live array, persist.
async function discard(queue, id) {
    const q = queue.getQueue(W);
    const cur = q.findIndex((e) => e.id === id);
    if (cur >= 0) q.splice(cur, 1);
    return queue.persistQueue();
}

describe('a local removal while queue writes are refused', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stays removed when the engine rehydrate recovers a failed lease reload', async () => {
        const ls = stubLocalStorage();
        const { store, queue, pushed: [x] } = await loadedTab('x', 'y');
        ls.faults.failReads = true;
        expect(await refreshBroadcastQueueStore(store)).toBe(false);

        expect(await discard(queue, x.id)).toBe(false);
        expect(hexes(ls.blob().queues[W])).toEqual(['x', 'y']);

        ls.faults.failReads = false;
        await queue.ensureQueueLoaded();
        expect(store.loaded).toBe(true);
        expect(hexes(queue.getQueue(W))).toEqual(['y']);
        expect(hexes(ls.blob().queues[W])).toEqual(['y']);
    });

    it('stays removed when a second lease reload recovers the failed one', async () => {
        const ls = stubLocalStorage();
        const { store, queue, pushed: [x] } = await loadedTab('x', 'y');
        const held = queue.getQueue(W);
        ls.faults.failReads = true;
        expect(await refreshBroadcastQueueStore(store)).toBe(false);
        expect(await discard(queue, x.id)).toBe(false);

        ls.faults.failReads = false;
        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        expect(queue.getQueue(W)).toBe(held);
        expect(hexes(held)).toEqual(['y']);
        expect(hexes(ls.blob().queues[W])).toEqual(['y']);
    });

    it('writes the emptied wallet back, though nothing is left to hold', async () => {
        const ls = stubLocalStorage();
        const { store, queue, pushed: [x] } = await loadedTab('x');
        ls.faults.failReads = true;
        expect(await refreshBroadcastQueueStore(store)).toBe(false);
        expect(await discard(queue, x.id)).toBe(false);

        ls.faults.failReads = false;
        await queue.ensureQueueLoaded();
        expect(queue.getQueue(W)).toEqual([]);
        expect(ls.blob().queues[W] ?? []).toEqual([]);
    });

    it('stays removed when its save failed while loaded and a lease reload follows', async () => {
        const ls = stubLocalStorage();
        const { store, queue, pushed: [x] } = await loadedTab('x', 'y');
        ls.faults.refuseWrites = true;
        expect(await discard(queue, x.id)).toBe(false);

        ls.faults.refuseWrites = false;
        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        expect(hexes(queue.getQueue(W))).toEqual(['y']);
        expect(hexes(ls.blob().queues[W])).toEqual(['y']);
    });

    it('still adopts an entry another tab added under the next lease', async () => {
        const ls = stubLocalStorage();
        const { store, queue, pushed: [x, y] } = await loadedTab('x', 'y');
        expect(await discard(queue, x.id)).toBe(true);
        const added = { ...y, id: 'from-other-tab', signedTxHex: 'z' };
        ls.writeBlob({ queues: { [W]: [{ ...y }, added] }, settlements: [] });

        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        expect(hexes(queue.getQueue(W))).toEqual(['y', 'z']);
    });
});
