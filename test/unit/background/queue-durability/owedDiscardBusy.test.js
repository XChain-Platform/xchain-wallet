// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An owed Discard is retired only by a discard that finished. Two overlapping
// flushes reach the same journal record: the second finds the first holding
// the PendingTx's claim, and if it read that refusal as settled it would drop
// the record while the first's delete can still fail, leaving the PendingTx
// 'queued' with nothing owed to remove it, so the next boot offers it again.

import { describe, it, expect } from 'vitest';
import { discardQueuedBroadcast } from '@xchain-wallet/core/flows/queuedBroadcast.js';
import { createBroadcastQueueEngine } from '../../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const P = 'ptx-1';

function memStorage() {
    const state = { blob: {}, owed: [] };
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        state,
        async load() { return copy(state.blob); },
        async loadSettlements() { return copy(state.owed); },
        async save(snapshot) { state.blob = copy(snapshot); },
        async saveSettlements(next) { state.owed = copy(next); },
        async clear() { state.blob = {}; state.owed = []; },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

/** A vault whose next PendingTx delete waits on `gate` and then settles as it says. */
function gatedVault() {
    const records = new Map([[P, { id: P, status: 'queued', txHex: 'hex', txid: 'txid', walletId: W }]]);
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const gate = { next: null, entered: deferred() };
    const vault = {
        pendingTxs: {
            get: async (id) => (records.has(id) ? copy(records.get(id)) : null),
            put: async (rec) => { records.set(rec.id, copy(rec)); },
            update: async (id, decide) => {
                const next = decide(records.has(id) ? copy(records.get(id)) : null);
                if (next == null) return false;
                records.set(id, copy(next));
                return true;
            },
            delete: async (id) => {
                const held = gate.next;
                gate.next = null;
                if (held) {
                    gate.entered.resolve();
                    await held.promise;
                }
                return records.delete(id);
            },
        },
    };
    return { vault, records, gate };
}

async function boot() {
    const storage = memStorage();
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast,
    });
    await engine.ensureQueueLoaded();
    return { storage, store, engine };
}

describe('owed discard under overlapping flushes', () => {
    it('keeps the owed discard when a second flush finds the first holding the claim and the first delete fails', async () => {
        const { storage, store, engine } = await boot();
        const { vault, records, gate } = gatedVault();
        engine.recordOwedSettlement(W, P, 'discard');
        const held = deferred();
        gate.next = held;

        const first = engine.flushOwedSettlements(vault);
        await gate.entered.promise;
        await engine.flushOwedSettlements(vault);
        held.reject(new Error('write failed'));
        await first;

        expect(store.owed).toHaveLength(1);
        expect(store.owed[0]).toMatchObject({ pendingTxId: P, op: 'discard' });
        expect(storage.state.owed).toEqual([expect.objectContaining({ pendingTxId: P, op: 'discard' })]);
        expect(records.get(P)).toMatchObject({ status: 'queued' });

        await engine.flushOwedSettlements(vault);
        expect(records.has(P)).toBe(false);
        expect(store.owed).toHaveLength(0);
        expect(storage.state.owed).toEqual([]);
    });

    it('keeps a reveal record that owes a discard while another discard holds the claim', async () => {
        const { store, engine } = await boot();
        const { vault, records, gate } = gatedVault();
        records.set(P, { ...records.get(P), revealTxHex: 'reveal-hex', revealTxid: 'reveal-txid' });
        const held = deferred();
        gate.next = held;
        const holder = discardQueuedBroadcast({ vault, pendingTxId: P });
        await gate.entered.promise;

        engine.recordOwedSettlement(W, P, 'reveal', { txid: 'reveal-txid', commitTxid: 'commit-txid' });
        engine.recordOwedSettlement(W, P, 'discard');
        expect(store.owed).toEqual([expect.objectContaining({ op: 'reveal', discard: true })]);
        await engine.flushOwedSettlements(vault);
        expect(store.owed).toEqual([expect.objectContaining({ pendingTxId: P, discard: true })]);

        held.reject(new Error('write failed'));
        await expect(holder).rejects.toThrow('write failed');
        await engine.flushOwedSettlements(vault);
        // The landed commit keeps its spend netted: the discard retires the reveal, not the record.
        expect(records.get(P)).toMatchObject({ status: 'broadcast', commitLanded: true });
        expect(store.owed).toHaveLength(0);
    });

    it('reports a held claim as busy, distinct from a record with nothing left to discard', async () => {
        // Its own id: the claim set is process-wide, so a claim another case
        // left held must not decide this one.
        const id = 'ptx-busy';
        const { vault, records, gate } = gatedVault();
        records.set(id, { ...records.get(P), id });
        const held = deferred();
        gate.next = held;
        const holder = discardQueuedBroadcast({ vault, pendingTxId: id });
        await gate.entered.promise;

        await expect(discardQueuedBroadcast({ vault, pendingTxId: id }))
            .rejects.toMatchObject({ code: 'QUEUED_BROADCAST_BUSY' });
        held.resolve();
        await expect(holder).resolves.toBe(true);
        await expect(discardQueuedBroadcast({ vault, pendingTxId: id })).resolves.toBe(false);
    });
});
