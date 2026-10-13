// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell's queue store goes dormant when its tab gives up the vault
// lease and is reloaded from storage when the tab takes the lease back.
//
// Three things must hold across that cycle. A tab without the lease never
// writes the shared key, so a late broadcast-failure hook cannot erase what
// the other tab saved. The reload keeps entries and journal records this tab
// holds only in memory because their save was refused, and keeps the arrays
// routes already hold. And a reload whose read fails must not let the next
// load merge back entries another tab removed while this one was dormant.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { __createWebVaultMultiTabHarnessForTests } from '../../../packages/web/src/hostBridge.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';
import {
    createBroadcastQueueStore,
    refreshBroadcastQueueStore,
} from '../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const V = 'w2';
const KEY = 'xchain.broadcastQueue';
const entry = (hex) => ({ chainId: 'bitcoin-regtest', signedTxHex: hex });
const hexes = (list) => (list ?? []).map((e) => e.signedTxHex).sort();
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

describe('web queue store without the vault lease', () => {
    it('refuses a late failure hook after release and keeps the other tab\'s queue and journal', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        const b = harness.createTab();

        await a.acquire();
        await a.enqueue(W, entry('aa'));
        const lateHook = a.failureHook(W);
        await a.release();

        await b.acquire();
        await b.enqueue(W, entry('bb'));
        b.recordOwed(W, 'ptx-b');
        await settle();

        const saved = await lateHook(entry('late'));
        a.recordOwed(W, 'ptx-a');
        await settle();

        const stored = harness.stored();
        expect(hexes(stored.queues[W])).toEqual(['aa', 'bb']);
        expect(stored.settlements.map((s) => s.pendingTxId)).toEqual(['ptx-b']);
        expect(saved).toBe(false);
    });

    it('writes what the dormant tab held once it takes the lease back', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        const b = harness.createTab();

        await a.acquire();
        const lateHook = a.failureHook(W);
        await a.release();

        await b.acquire();
        await b.enqueue(W, entry('bb'));
        b.recordOwed(W, 'ptx-b');
        await settle();
        await lateHook(entry('late'));
        a.recordOwed(W, 'ptx-a');
        await b.release();

        await a.acquire();
        await settle();
        const stored = harness.stored();
        expect(hexes(stored.queues[W])).toEqual(['bb', 'late']);
        expect(stored.settlements.map((s) => s.pendingTxId).sort()).toEqual(['ptx-a', 'ptx-b']);
    });

    it('holds the lease while a signing route runs, so its failure hook writes under it', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        const b = harness.createTab();

        await a.acquire();
        const network = deferred();
        const route = a.dispatch('action.send', async () => {
            await network.promise;
            return a.failureHook(W)(entry('late'));
        });
        await a.release();
        expect(a.state()).toEqual({ hasLease: true, releaseDeferred: true });
        await expect(b.acquire()).rejects.toThrow();

        network.resolve();
        expect(await route).toBe(true);
        await a.whenReleased();
        expect(a.state()).toEqual({ hasLease: false, releaseDeferred: false });

        await b.acquire();
        expect(hexes(await b.list(W))).toEqual(['late']);
    });

    it('does not hold the lease for a route that cannot queue signed bytes', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        await a.acquire();
        const network = deferred();
        const route = a.dispatch('balances.escrowed', () => network.promise);
        await a.release();
        expect(a.state()).toEqual({ hasLease: false, releaseDeferred: false });
        network.resolve();
        await route;
    });
});

/** A localStorage double whose writes or reads can be made to fail. */
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
        // Another tab's write, straight to the shared key.
        writeBlob: (blob) => items.set(KEY, JSON.stringify(blob)),
    };
}

function buildTab() {
    const store = createBroadcastQueueStore({ storage: createBroadcastQueueStorage(), prunedLedger: null });
    const queue = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
    return { store, queue };
}

describe('reloading the web queue store on a fresh lease', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps an entry whose save was refused, in the array routes already hold', async () => {
        const ls = stubLocalStorage();
        const { store, queue } = buildTab();
        await queue.ensureQueueLoaded();
        queue.pushQueueEntry(W, entry('x'));
        expect(await queue.persistQueue()).toBe(true);

        ls.faults.refuseWrites = true;
        queue.pushQueueEntry(W, entry('y'));
        expect(await queue.persistQueue()).toBe(false);
        const held = queue.getQueue(W);

        ls.faults.refuseWrites = false;
        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        await settle();

        expect(queue.getQueue(W)).toBe(held);
        expect(hexes(held)).toEqual(['x', 'y']);
        expect(hexes(ls.blob().queues[W])).toEqual(['x', 'y']);
    });

    it('keeps a journal record whose save was refused, as the same object', async () => {
        const ls = stubLocalStorage();
        const { store, queue } = buildTab();
        await queue.ensureQueueLoaded();

        ls.faults.refuseWrites = true;
        queue.recordOwedSettlement(W, 'ptx-1', 'patch', { status: 'broadcast' });
        await settle();
        const record = store.owed[0];

        ls.faults.refuseWrites = false;
        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        await settle();

        expect(store.owed).toHaveLength(1);
        expect(store.owed[0]).toBe(record);
        expect(ls.blob().settlements.map((s) => s.pendingTxId)).toEqual(['ptx-1']);
    });

    it('still drops a saved entry another tab removed while keeping the unsaved one', async () => {
        const ls = stubLocalStorage();
        const { store, queue } = buildTab();
        await queue.ensureQueueLoaded();
        queue.pushQueueEntry(W, entry('x'));
        await queue.persistQueue();
        const kept = queue.pushQueueEntry(W, entry('keep'));
        await queue.persistQueue();

        ls.faults.refuseWrites = true;
        queue.pushQueueEntry(W, entry('y'));
        await queue.persistQueue();
        ls.faults.refuseWrites = false;

        ls.writeBlob({ queues: { [W]: [{ ...kept }] }, settlements: [] });
        expect(await refreshBroadcastQueueStore(store)).toBe(true);

        expect(hexes(queue.getQueue(W))).toEqual(['keep', 'y']);
    });

    it('keeps an entry pushed while the reload is still reading', async () => {
        const copy = (v) => JSON.parse(JSON.stringify(v));
        let blob = { queues: {}, settlements: [] };
        let cached = [];
        let gate = null;
        const storage = {
            async load() {
                if (gate) await gate.promise;
                const read = copy(blob);
                cached = read.settlements;
                return read.queues;
            },
            async loadSettlements() { return copy(cached); },
            async save(queues) { blob = { queues: copy(queues), settlements: copy(cached) }; },
            async saveSettlements(owed) { cached = copy(owed); blob = { ...blob, settlements: copy(cached) }; },
            async clear() { blob = { queues: {}, settlements: [] }; },
        };
        const store = createBroadcastQueueStore({ storage, prunedLedger: null });
        const queue = createBroadcastQueueEngine({
            store,
            importedAddressIdsFor: async () => new Set(),
            discardQueuedBroadcast: async () => {},
        });
        await queue.ensureQueueLoaded();
        queue.pushQueueEntry(W, entry('x'));
        await queue.persistQueue();

        gate = deferred();
        const reload = refreshBroadcastQueueStore(store);
        await settle();
        expect(store.loaded).toBe(false);
        queue.pushQueueEntry(W, entry('mid'));
        gate.resolve();
        gate = null;
        expect(await reload).toBe(true);
        await settle();

        expect(hexes(queue.getQueue(W))).toEqual(['mid', 'x']);
        expect(hexes(blob.queues[W])).toEqual(['mid', 'x']);
    });

    it('keeps a wallet removed while dormant out of the reloaded queue', async () => {
        const ls = stubLocalStorage();
        const { store, queue } = buildTab();
        await queue.ensureQueueLoaded();
        queue.pushQueueEntry(W, entry('w'));
        queue.pushQueueEntry(V, entry('v'));
        await queue.persistQueue();

        store.dormant = true;
        await queue.pruneWalletFromQueue(V);
        expect(hexes(ls.blob().queues[V])).toEqual(['v']);

        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        expect(store.queues.has(V)).toBe(false);
        expect(ls.blob().queues[V]).toBeUndefined();
        expect(hexes(ls.blob().queues[W])).toEqual(['w']);
    });

    it('recovers a failed reload without resurrecting what another tab removed', async () => {
        const ls = stubLocalStorage();
        const { store, queue } = buildTab();
        await queue.ensureQueueLoaded();
        const x = queue.pushQueueEntry(W, entry('x'));
        const y = queue.pushQueueEntry(W, entry('y'));
        queue.pushQueueEntry(V, entry('q'));
        await queue.persistQueue();
        queue.recordOwedSettlement(W, 'ptx-old', 'patch', { status: 'broadcast' });
        await settle();
        expect(ls.blob().settlements.map((s) => s.pendingTxId)).toEqual(['ptx-old']);

        // The other tab broadcast x, removed wallet V and drained the journal.
        ls.writeBlob({ queues: { [W]: [{ ...y }] }, settlements: [] });
        ls.faults.failReads = true;
        expect(await refreshBroadcastQueueStore(store)).toBe(false);

        // Queued while the read is still failing, so memory is its only copy.
        queue.pushQueueEntry(W, entry('z'));
        queue.recordOwedSettlement(W, 'ptx-new', 'patch', { status: 'broadcast' });
        await settle();

        ls.faults.failReads = false;
        await queue.ensureQueueLoaded();
        await settle();

        expect(store.loaded).toBe(true);
        expect(hexes(queue.getQueue(W))).toEqual(['y', 'z']);
        expect(queue.getQueue(V)).toEqual([]);
        expect(store.owed.map((s) => s.pendingTxId)).toEqual(['ptx-new']);
        const blob = ls.blob();
        expect(hexes(blob.queues[W])).toEqual(['y', 'z']);
        expect(blob.queues[V]).toBeUndefined();
        expect(blob.queues[W].some((e) => e.id === x.id)).toBe(false);
        expect(blob.settlements.map((s) => s.pendingTxId)).toEqual(['ptx-new']);
    });
});
