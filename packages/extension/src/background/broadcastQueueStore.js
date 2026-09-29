// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastQueueStore: the live state of the queued-broadcast surface.
//
// A lock tears the host down and the next unlock builds a new one, but a
// broadcast already waiting on the network keeps running on the old host.
// Each host holding its own copy of the queue let that late broadcast write a
// stale queue over the one the new host had just saved, so a shell holds ONE
// store for its whole process and hands it to every host it builds.

/**
 * @typedef {import('./broadcastQueueStorage.js').BroadcastQueueStorage} BroadcastQueueStorage
 */

/**
 * The queue map, settlement journal, load and seal latches, and in-flight
 * broadcast claims every host of one process shares. The host's queue helpers
 * read and write these fields directly; nothing else should.
 *
 * @typedef {Object} BroadcastQueueStore
 * @property {BroadcastQueueStorage | null} storage  the one writer of the stored key
 * @property {Map<string, any[]>} queues  walletId to its live entry array
 * @property {Array<{ id: string, walletId?: string, pendingTxId: string, op: 'patch' | 'discard', patch?: object, recordedAt: number }>} owed
 *   PendingTx writes a closed or refusing vault could not take yet
 * @property {boolean} loaded  the stored blob has been read into `queues`
 * @property {boolean} sealed  a wallet wipe ended this store; nothing writes again
 * @property {Promise<boolean> | null} loadPromise  the single-flight rehydrate
 * @property {Set<string>} inFlight  `walletId:entryId` claims of broadcasts on the network
 */

/**
 * Build an empty store over one storage adapter.
 *
 * @param {{ storage?: BroadcastQueueStorage | null }} [opts]
 *   `null` keeps the queue in memory only, as the host's own opt-out does
 * @returns {BroadcastQueueStore}
 */
export function createBroadcastQueueStore({ storage = null } = {}) {
    return {
        storage,
        queues: new Map(),
        owed: [],
        loaded: false,
        sealed: false,
        loadPromise: null,
        inFlight: new Set(),
    };
}

/**
 * End a store for good before a wallet wipe removes the stored key.
 *
 * The flag stops later writers, emptying the map and journal stops a route
 * serving what the wipe removed, and the adapter's `clear()` drops its cached
 * halves so a write already past the flag stores an empty envelope. Never
 * throws: a failed clear must not fail the wipe, which removes the key itself.
 *
 * @param {BroadcastQueueStore} store
 * @returns {Promise<void>}
 */
export async function sealBroadcastQueueStore(store) {
    store.sealed = true;
    store.queues.clear();
    store.owed = [];
    if (typeof store.storage?.clear === 'function') {
        try {
            await store.storage.clear();
        } catch (_e) {
            // Only the adapter's cache was at stake; the wipe removes the key.
        }
    }
}
