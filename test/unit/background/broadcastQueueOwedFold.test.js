// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The owed-settlement journal keeps one record per PendingTx, and a later
// write folds onto the earlier one instead of replacing it. The case that
// matters: the advance-to-reveal patch (commit landed, reveal bytes) is owed
// while the vault is closed, a transient reveal failure then owes a
// status-only patch, and a later Discard must still keep the landed commit's
// record 'broadcast' so its spend stays netted.

import { describe, it, expect } from 'vitest';
import { discardQueuedBroadcast } from '@xchain-wallet/core/flows/queuedBroadcast.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import {
    createBroadcastQueueStore,
    foldOwedSettlement,
    refreshBroadcastQueueStore,
} from '../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const P = 'ptx-1';
const COMMIT_HEX = 'commit-hex';
const REVEAL_HEX = 'reveal-hex';
const ADVANCE = {
    status: 'broadcasting',
    txHex: REVEAL_HEX,
    txid: 'reveal-txid',
    commitLanded: true,
    commitTxid: 'commit-txid',
    error: null,
};
const TRANSIENT = { status: 'queued', error: 'network timeout' };

function memStorage(seedOwed = []) {
    let blob = {};
    let owed = JSON.parse(JSON.stringify(seedOwed));
    return {
        async load() { return JSON.parse(JSON.stringify(blob)); },
        async loadSettlements() { return JSON.parse(JSON.stringify(owed)); },
        async save(snapshot) { blob = JSON.parse(JSON.stringify(snapshot)); },
        async saveSettlements(next) { owed = JSON.parse(JSON.stringify(next)); },
        async clear() { blob = {}; owed = []; },
    };
}

/** A vault whose PendingTx reads refuse while `closed`, the torn-down host case. */
function memVault() {
    const records = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const vault = {
        closed: false,
        pendingTxs: {
            get: async (id) => {
                if (vault.closed) throw new Error('VaultStateError: vault is closed');
                return records.has(id) ? copy(records.get(id)) : null;
            },
            put: async (rec) => {
                if (vault.closed) throw new Error('VaultStateError: vault is closed');
                records.set(rec.id, copy(rec));
            },
            delete: async (id) => {
                if (vault.closed) throw new Error('VaultStateError: vault is closed');
                return records.delete(id);
            },
        },
    };
    records.set(P, { id: P, status: 'queued', txHex: COMMIT_HEX, txid: 'commit-txid', walletId: W });
    return { vault, records };
}

function boot(storage) {
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast,
    });
    return { store, engine };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('owed settlement fold', () => {
    it('stacks a status-only patch on an owed advance patch, so a later Discard keeps the commit', async () => {
        const { store, engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();

        engine.recordOwedSettlement(W, P, 'patch', ADVANCE);
        engine.recordOwedSettlement(W, P, 'patch', TRANSIENT);
        expect(store.owed).toHaveLength(1);

        await engine.flushOwedSettlements(vault);
        expect(store.owed).toHaveLength(0);
        expect(records.get(P)).toMatchObject({ status: 'queued', txHex: REVEAL_HEX, commitLanded: true });

        expect(await discardQueuedBroadcast({ vault, pendingTxId: P })).toBe(true);
        expect(records.get(P)).toMatchObject({ status: 'broadcast', txid: 'commit-txid' });
    });

    it('replays an owed advance patch before an owed Discard of the same entry', async () => {
        const { store, engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();

        engine.recordOwedSettlement(W, P, 'patch', ADVANCE);
        engine.recordOwedSettlement(W, P, 'discard');
        expect(store.owed).toHaveLength(1);

        await engine.flushOwedSettlements(vault);
        expect(store.owed).toHaveLength(0);
        expect(records.get(P)).toMatchObject({ status: 'broadcast', txid: 'commit-txid', commitLanded: true });
    });

    it('keeps the reveal bytes when the reveal lands after an owed advance patch', async () => {
        const { engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();

        engine.recordOwedSettlement(W, P, 'patch', ADVANCE);
        engine.recordOwedSettlement(W, P, 'patch', { status: 'broadcast', txid: 'reveal-txid', error: null });

        await engine.flushOwedSettlements(vault);
        expect(records.get(P)).toMatchObject({
            status: 'broadcast', txHex: REVEAL_HEX, txid: 'reveal-txid', commitTxid: 'commit-txid',
        });
    });

    it('rebuilds a byte-free reveal settlement before applying its later patch', async () => {
        const { store, engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();
        Object.assign(records.get(P), { revealTxHex: REVEAL_HEX, revealTxid: 'reveal-txid' });

        engine.recordOwedSettlement(W, P, 'reveal', { txid: 'reveal-txid', commitTxid: 'commit-txid' });
        engine.recordOwedSettlement(W, P, 'patch', TRANSIENT);
        expect(store.owed[0]).toMatchObject({ op: 'reveal', patch: TRANSIENT });
        expect(JSON.stringify(store.owed)).not.toContain(REVEAL_HEX);
        expect(JSON.stringify(store.owed)).not.toContain(COMMIT_HEX);

        await engine.flushOwedSettlements(vault);
        expect(records.get(P)).toMatchObject({
            status: 'queued', txHex: REVEAL_HEX, txid: 'reveal-txid',
            commitLanded: true, commitTxid: 'commit-txid',
        });
    });

    it('promotes a byte-free reveal settlement before its folded discard', async () => {
        const { store, engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();
        Object.assign(records.get(P), { revealTxHex: REVEAL_HEX, revealTxid: 'reveal-txid' });

        engine.recordOwedSettlement(W, P, 'reveal', { txid: 'reveal-txid', commitTxid: 'commit-txid' });
        engine.recordOwedSettlement(W, P, 'discard');
        expect(store.owed[0]).toMatchObject({ op: 'reveal', discard: true });

        await engine.flushOwedSettlements(vault);
        expect(records.get(P)).toMatchObject({ status: 'broadcast', txid: 'commit-txid', commitLanded: true });
    });

    it('does not promote a record whose reveal bytes are unavailable', async () => {
        const { store, engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();
        engine.recordOwedSettlement(W, P, 'reveal', { txid: 'reveal-txid', commitTxid: 'commit-txid' });

        await engine.flushOwedSettlements(vault);

        expect(store.owed).toHaveLength(0);
        expect(records.get(P)).toMatchObject({ status: 'queued', txHex: COMMIT_HEX, txid: 'commit-txid' });
        expect(records.get(P).commitLanded).toBeUndefined();
    });

    it('does not label reveal bytes with the commit txid when the reveal txid is unknown', async () => {
        const { engine } = boot(memStorage());
        await engine.ensureQueueLoaded();
        const { vault, records } = memVault();
        Object.assign(records.get(P), { revealTxHex: REVEAL_HEX });
        engine.recordOwedSettlement(W, P, 'reveal', { txid: null, commitTxid: 'commit-txid' });

        await engine.flushOwedSettlements(vault);

        expect(records.get(P)).toMatchObject({ txHex: REVEAL_HEX, txid: null, commitLanded: true });
    });

    it('folds a live record onto the persisted advance patch for the same entry on load', async () => {
        const persisted = [{ id: 's-old', walletId: W, pendingTxId: P, op: 'patch', patch: ADVANCE, recordedAt: 1 }];
        const { store, engine } = boot(memStorage(persisted));
        // Recorded before the first load latched, so its own persist was refused.
        engine.recordOwedSettlement(W, P, 'patch', TRANSIENT);
        await engine.ensureQueueLoaded();
        expect(store.owed).toHaveLength(1);

        const { vault, records } = memVault();
        await engine.flushOwedSettlements(vault);
        expect(records.get(P)).toMatchObject({ status: 'queued', txHex: REVEAL_HEX, commitLanded: true });
    });

    it('folds a write made while dormant onto the advance patch another writer stored', async () => {
        const storage = memStorage();
        const { store, engine } = boot(storage);
        await engine.ensureQueueLoaded();
        store.dormant = true;
        // Another tab held the lease and journaled the advance patch.
        await storage.saveSettlements([{ id: 's-other', walletId: W, pendingTxId: P, op: 'patch', patch: ADVANCE, recordedAt: 1 }]);
        engine.recordOwedSettlement(W, P, 'patch', TRANSIENT);

        expect(await refreshBroadcastQueueStore(store)).toBe(true);
        expect(store.owed).toHaveLength(1);

        const { vault, records } = memVault();
        await engine.flushOwedSettlements(vault);
        expect(records.get(P)).toMatchObject({ status: 'queued', txHex: REVEAL_HEX, commitLanded: true });
    });

    it('drops a later write once an earlier discard or terminal patch closed the record', () => {
        const discard = { id: 'a', pendingTxId: P, op: 'discard' };
        const landed = { id: 'b', pendingTxId: P, op: 'patch', patch: { status: 'broadcast' } };
        const later = { id: 'c', pendingTxId: P, op: 'patch', patch: TRANSIENT };
        expect(foldOwedSettlement(discard, later)).toBe(discard);
        expect(foldOwedSettlement(landed, later)).toBe(landed);
        expect(foldOwedSettlement(undefined, later)).toBe(later);
    });

    it('keeps a refresh load latched when an older failed load finishes later', async () => {
        const first = deferred();
        const refreshRead = deferred();
        let loads = 0;
        const storage = memStorage();
        storage.load = async () => (++loads === 1 ? first.promise : refreshRead.promise);
        const { store, engine } = boot(storage);

        const initial = engine.ensureQueueLoaded();
        const refresh = refreshBroadcastQueueStore(store);
        const waiter = engine.ensureQueueLoaded();
        first.resolve(null);
        await initial;

        expect(loads).toBe(2);
        expect(store.loadPromise).not.toBeNull();
        refreshRead.resolve({});
        await Promise.all([refresh, waiter]);
        expect(store.loaded).toBe(true);
    });

    it('does not let a failed refresh clear a newer engine load', async () => {
        const refreshRead = deferred();
        const engineRead = deferred();
        let loads = 0;
        const storage = memStorage();
        storage.load = async () => (++loads === 1 ? refreshRead.promise : engineRead.promise);
        const { store, engine } = boot(storage);

        const refresh = refreshBroadcastQueueStore(store);
        store.loadPromise = null;
        const engineLoad = engine.ensureQueueLoaded();
        refreshRead.resolve(null);
        expect(await refresh).toBe(false);

        expect(store.loadPromise).not.toBeNull();
        engineRead.resolve({});
        await engineLoad;
        expect(store.loaded).toBe(true);
    });

    it('does not merge a stale load after a different load marked the store loaded', async () => {
        const first = deferred();
        const stale = deferred();
        let loads = 0;
        const storage = memStorage();
        storage.load = async () => (++loads === 1 ? first.promise : stale.promise);
        const { store, engine } = boot(storage);
        const entry = { id: 'renderer-1', chainId: 'test', signedTxHex: '00' };

        const refresh = refreshBroadcastQueueStore(store);
        store.loadPromise = null;
        const lateLoad = engine.ensureQueueLoaded();
        first.resolve({ [W]: [entry] });
        await refresh;
        store.queues.get(W).splice(0, 1);
        stale.resolve({ [W]: [entry] });
        await lateLoad;

        expect(loads).toBe(2);
        expect(store.queues.get(W)).toEqual([]);
    });
});
