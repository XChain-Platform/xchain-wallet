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

import { BROADCAST_QUEUE_PRUNED_PREFIX } from '@xchain-wallet/core/shared/utils/wipeWalletStorage.js';

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
 * @property {Map<string, import('./broadcastQueueStorage.js').QueueEntry[]>} queues  walletId to its live entry array
 * @property {Array<{ id: string, walletId?: string, pendingTxId: string, op: 'patch' | 'discard', patch?: object, recordedAt: number }>} owed
 *   PendingTx writes a closed or refusing vault could not take yet
 * @property {boolean} loaded  the stored blob has been read into `queues`
 * @property {boolean} sealed  a wallet wipe ended this store; nothing writes again
 * @property {boolean} dormant  the shell gave up its writer lease; nothing loads
 *   or writes until `refreshBroadcastQueueStore` runs under the next lease
 * @property {PersistedRecord} persisted  what the stored key is known to hold
 * @property {Promise<boolean> | null} loadPromise  the single-flight rehydrate
 * @property {Set<string>} inFlight  `walletId:entryId` claims of broadcasts on the network,
 *   plus the web shell's claims for routes that can queue signed bytes
 * @property {Set<string>} prunedWallets  walletIds removed before `loaded` latched,
 *   which the rehydrate merge skips and its write-back drops from the blob;
 *   each add is also written to a durable ledger so a worker evicted before
 *   the read recovers still drops the wallet on the next boot
 */

/**
 * The entry ids per wallet and the journal record keys the last load or save
 * that resolved found in, or wrote to, the stored key. Each update replaces
 * both fields with new objects, so a reader that captures them before a read
 * still holds what was known before it.
 *
 * @typedef {Object} PersistedRecord
 * @property {Map<string, Set<string>>} queues
 * @property {Set<string>} owed
 */

// Core owns the prefix so both wipe paths sweep exactly the keys written here.
const PRUNED_PREFIX = BROADCAST_QUEUE_PRUNED_PREFIX;

/** Journal length cap, shared by the engine and the lease reload. */
export const OWED_SETTLEMENT_LIMIT = 50;

/**
 * The key a journal record is known by in a `PersistedRecord`.
 *
 * @param {{ id?: unknown, pendingTxId?: unknown }} record
 * @returns {string}
 */
export function owedRecordKey(record) {
    return typeof record?.id === 'string' && record.id ? record.id : `pending:${String(record?.pendingTxId)}`;
}

/**
 * Whether a live entry never reached the stored key, judged against what was
 * known before the read now being folded in. Only such an entry may survive a
 * snapshot that lacks it; an entry the key held was removed by its other writer.
 *
 * @param {Map<string, Set<string>> | undefined} known
 * @param {string} walletId
 * @param {any} entry
 */
export function isMemoryOnlyEntry(known, walletId, entry) {
    if (typeof entry?.id !== 'string' || !entry.id) return false;
    return !known?.get(walletId)?.has(entry.id);
}

function queueKeysOf(snapshot) {
    /** @type {Map<string, Set<string>>} */
    const keys = new Map();
    for (const [walletId, entries] of Object.entries(snapshot)) {
        if (!Array.isArray(entries)) continue;
        const ids = new Set(entries.map((e) => e?.id).filter((id) => typeof id === 'string' && id));
        if (ids.size > 0) keys.set(walletId, ids);
    }
    return keys;
}

function owedKeysOf(owed) {
    return new Set((Array.isArray(owed) ? owed : []).filter(Boolean).map(owedRecordKey));
}

// Track what the key holds from the calls that resolved. Either save writes
// the pair (the half it was given plus the adapter's cached other half), so
// `pair` follows the halves the next write would carry. A refused save leaves
// the record alone, and a call that resolves after a later one does not
// overwrite the newer record.
function withPersistedRecord(storage, persisted) {
    const wrapped = Object.create(storage);
    const pair = { queues: persisted.queues, owed: persisted.owed };
    let issued = 0;
    let applied = 0;
    const commit = (ticket, queues, owed) => {
        if (ticket <= applied) return;
        applied = ticket;
        persisted.queues = queues;
        persisted.owed = owed;
    };
    wrapped.load = async () => {
        const ticket = ++issued;
        const snapshot = await storage.load();
        if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
            pair.queues = queueKeysOf(snapshot);
            commit(ticket, pair.queues, persisted.owed);
        }
        return snapshot;
    };
    wrapped.save = async (snapshot) => {
        const ticket = ++issued;
        const queues = queueKeysOf(snapshot);
        const owed = pair.owed;
        pair.queues = queues;
        await storage.save(snapshot);
        commit(ticket, queues, owed);
    };
    if (typeof storage.loadSettlements === 'function') {
        wrapped.loadSettlements = async () => {
            const ticket = ++issued;
            const owed = await storage.loadSettlements();
            if (Array.isArray(owed)) {
                pair.owed = owedKeysOf(owed);
                commit(ticket, persisted.queues, pair.owed);
            }
            return owed;
        };
    }
    if (typeof storage.saveSettlements === 'function') {
        wrapped.saveSettlements = async (records) => {
            const ticket = ++issued;
            const owed = owedKeysOf(records);
            const queues = pair.queues;
            pair.owed = owed;
            await storage.saveSettlements(records);
            commit(ticket, queues, owed);
        };
    }
    return wrapped;
}

function chromeLedger() {
    const settle = (resolve, reject) => () => (chrome.runtime?.lastError ? reject(new Error('pruned ledger write refused')) : resolve());
    const ledgerIds = (keys) => keys.filter((k) => k.startsWith(PRUNED_PREFIX)).map((k) => k.slice(PRUNED_PREFIX.length));
    const listByReadingAll = () => new Promise((resolve) => {
        try {
            chrome.storage.local.get(null, (items) => {
                if (chrome.runtime?.lastError || !items) { resolve(null); return; }
                resolve(ledgerIds(Object.keys(items)));
            });
        } catch (_e) {
            resolve(null);
        }
    });
    return {
        // List key names only: the local area also holds the vault and the queue
        // blob, and every save runs this. getKeys needs Chrome 130+, so any
        // missing or failing getKeys falls back to reading the whole area.
        async list() {
            let keys = null;
            try {
                if (typeof chrome.storage.local.getKeys === 'function') keys = await chrome.storage.local.getKeys();
            } catch (_e) {
                keys = null;
            }
            return Array.isArray(keys) ? ledgerIds(keys) : listByReadingAll();
        },
        add(id) {
            return new Promise((resolve, reject) => {
                try {
                    chrome.storage.local.set({ [PRUNED_PREFIX + id]: 1 }, settle(resolve, reject));
                } catch (err) {
                    reject(err);
                }
            });
        },
        remove(ids) {
            if (ids.length === 0) return Promise.resolve();
            return new Promise((resolve, reject) => {
                try {
                    chrome.storage.local.remove(ids.map((id) => PRUNED_PREFIX + id), settle(resolve, reject));
                } catch (err) {
                    reject(err);
                }
            });
        },
    };
}

function localLedger() {
    return {
        async list() {
            try {
                const ids = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(PRUNED_PREFIX)) ids.push(k.slice(PRUNED_PREFIX.length));
                }
                return ids;
            } catch (_e) {
                return null;
            }
        },
        async add(id) {
            localStorage.setItem(PRUNED_PREFIX + id, '1');
        },
        async remove(ids) {
            for (const id of ids) localStorage.removeItem(PRUNED_PREFIX + id);
        },
    };
}

function defaultLedger() {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chromeLedger();
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') return localLedger();
    } catch (_e) {
        // Access can throw under sandboxed iframes; the ledger is then unavailable.
    }
    return null;
}

/**
 * The prune set, mirrored to a durable ledger with one record per walletId so
 * a write never has to read the store, which is what is failing when a prune
 * lands here. An add starts its write in the same tick.
 */
class PrunedWallets extends Set {
    constructor(ledger) {
        super();
        this.ledger = ledger;
        this.tail = Promise.resolve();
    }

    add(id) {
        const fresh = !this.has(id);
        super.add(id);
        if (fresh && this.ledger) this.queue(() => this.ledger.add(id));
        return this;
    }

    hydrate(ids) {
        for (const id of ids) super.add(id);
    }

    async forget(snapshot) {
        const stored = await this.ledger.list();
        if (stored === null) return;
        await this.ledger.remove(stored.filter((id) => !(Array.isArray(snapshot?.[id]) && snapshot[id].length > 0)));
    }

    async erase() {
        if (!this.ledger) return;
        await this.queue(async () => {
            const stored = await this.ledger.list();
            if (stored) await this.ledger.remove(stored);
        });
    }

    queue(job) {
        const run = this.tail.then(job);
        this.tail = run.catch(() => {});
        return run;
    }
}

function withLedger(storage, pruned) {
    const wrapped = Object.create(storage);
    wrapped.load = async () => {
        const snapshot = await storage.load();
        if (!snapshot || typeof snapshot !== 'object') return snapshot;
        await pruned.tail;
        const ids = await pruned.ledger.list();
        // An unreadable ledger is an unreadable store: fail closed like a failed load.
        if (ids === null) return null;
        pruned.hydrate(ids);
        return snapshot;
    };
    wrapped.save = async (snapshot) => {
        await storage.save(snapshot);
        try {
            await pruned.queue(() => pruned.forget(snapshot));
        } catch (_e) {
            // A stale entry only skips a wallet the blob no longer holds.
        }
    };
    return wrapped;
}

/**
 * Build an empty store over one storage adapter.
 *
 * @param {{ storage?: BroadcastQueueStorage | null,
 *           prunedLedger?: { list: () => Promise<string[] | null>, add: (id: string) => Promise<void>, remove: (ids: string[]) => Promise<void> } | null }} [opts]
 *   `storage: null` keeps the queue in memory only, as the host's own opt-out
 *   does; `prunedLedger` replaces the default durable ledger, `null` drops it
 * @returns {BroadcastQueueStore}
 */
export function createBroadcastQueueStore({ storage = null, prunedLedger } = {}) {
    const ledger = storage ? (prunedLedger === undefined ? defaultLedger() : prunedLedger) : null;
    const prunedWallets = new PrunedWallets(ledger);
    /** @type {PersistedRecord} */
    const persisted = { queues: new Map(), owed: new Set() };
    const backing = ledger ? withLedger(storage, prunedWallets) : storage;
    return {
        storage: backing ? withPersistedRecord(backing, persisted) : backing,
        queues: new Map(),
        owed: [],
        loaded: false,
        sealed: false,
        dormant: false,
        persisted,
        loadPromise: null,
        inFlight: new Set(),
        prunedWallets,
    };
}

// Fold a fresh read into the live map and journal in place: the stored copy
// wins for everything the key held, and only what never reached it is carried
// over. Arrays and journal objects keep their identity, because routes splice
// the arrays `getQueue` handed them and the journal flush retires by identity.
// Returns whether anything was carried over, which the key now lacks.
function adoptStoredState(store, snapshot, settlements, known) {
    const pruned = store.prunedWallets;
    let carried = false;
    const wallets = new Set([...store.queues.keys(), ...Object.keys(snapshot)]);
    for (const walletId of wallets) {
        if (pruned?.has(walletId)) {
            store.queues.delete(walletId);
            continue;
        }
        const stored = Array.isArray(snapshot[walletId])
            ? snapshot[walletId].filter((entry) => entry && typeof entry === 'object')
            : [];
        const storedIds = new Set(stored.map((entry) => entry.id));
        const storedTxs = new Set(stored.map((entry) => entry.pendingTxId).filter(Boolean));
        const live = store.queues.get(walletId);
        const kept = (live ?? []).filter((entry) => isMemoryOnlyEntry(known.queues, walletId, entry)
            && !storedIds.has(entry.id)
            && !(entry.pendingTxId && storedTxs.has(entry.pendingTxId)));
        if (kept.length > 0) carried = true;
        if (live) live.splice(0, live.length, ...stored, ...kept);
        else if (stored.length > 0) store.queues.set(walletId, stored);
    }

    const storedOwed = settlements
        .filter((entry) => entry && typeof entry === 'object')
        .filter((entry) => !entry.walletId || !pruned?.has(entry.walletId));
    const storedKeys = new Set(storedOwed.map(owedRecordKey));
    const liveByKey = new Map(store.owed.map((entry) => [owedRecordKey(entry), entry]));
    const carriedOwed = store.owed.filter((entry) => !known.owed?.has(owedRecordKey(entry))
        && !storedKeys.has(owedRecordKey(entry))
        && !(entry.walletId && pruned?.has(entry.walletId)));
    if (carriedOwed.length > 0) carried = true;
    // One record per PendingTx: a carried record is the later write.
    const carriedTxs = new Set(carriedOwed.map((entry) => entry.pendingTxId));
    store.owed = [
        ...storedOwed
            .filter((entry) => !carriedTxs.has(entry.pendingTxId))
            .map((entry) => liveByKey.get(owedRecordKey(entry)) ?? { ...entry }),
        ...carriedOwed,
    ].slice(-OWED_SETTLEMENT_LIMIT);
    return carried;
}

/**
 * Reload a dormant store from persistence after its shell acquires an
 * exclusive writer lease, and end its dormancy. Both halves are read before
 * live state changes, so an unreadable queue or journal leaves the cache
 * intact and `loaded` false; the engine's next load then folds the read in
 * by the same persisted record, so what another writer removed stays removed.
 * Entries and journal records whose save was refused, or that were made while
 * dormant, survive the reload and are written back under the lease.
 *
 * @param {BroadcastQueueStore | null} store
 * @returns {Promise<boolean>} whether the persisted state was folded in
 */
export async function refreshBroadcastQueueStore(store) {
    if (!store || store.sealed) return false;
    if (!store.storage) {
        store.dormant = false;
        return false;
    }
    const previousLoad = store.loadPromise;
    if (previousLoad) {
        try { await previousLoad; } catch (_err) { /* retry from storage below */ }
    }
    if (store.sealed) return false;

    // Cleared with `loaded` in one step: no write can run on the cache the
    // dormant tab held, and the lease makes this store the writer again.
    store.loaded = false;
    store.dormant = false;
    store.loadPromise = (async () => {
        const known = { queues: store.persisted?.queues, owed: store.persisted?.owed };
        let snapshot;
        let settlements = [];
        try {
            snapshot = await store.storage.load();
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
            if (typeof store.storage.loadSettlements === 'function') {
                settlements = await store.storage.loadSettlements();
                if (!Array.isArray(settlements)) return false;
            }
        } catch (_err) {
            return false;
        }
        if (store.sealed) return false;

        const pruned = store.prunedWallets;
        const carried = adoptStoredState(store, snapshot, settlements, known);
        store.loaded = true;

        if (carried || pruned?.size > 0) {
            const queues = {};
            for (const [walletId, entries] of store.queues.entries()) {
                if (entries.length > 0) queues[walletId] = [...entries];
            }
            try {
                await store.storage.save(queues);
                if (typeof store.storage.saveSettlements === 'function') {
                    await store.storage.saveSettlements(store.owed.map((entry) => ({ ...entry })));
                }
                pruned?.clear();
            } catch (_err) {
                // Live state is complete; the durable prune ledger keeps the
                // retry safe, and carried items stay unrecorded for the next save.
            }
        }
        return true;
    })();

    const refreshed = await store.loadPromise;
    if (!refreshed) store.loadPromise = null;
    return refreshed;
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
    store.prunedWallets?.clear();
    // Not awaited: a read already held by the failing store must not stall the
    // wipe, and the ledger holds walletIds only.
    store.prunedWallets?.erase?.().catch(() => {});
    if (typeof store.storage?.clear === 'function') {
        try {
            await store.storage.clear();
        } catch (_e) {
            // Only the adapter's cache was at stake; the wipe removes the key.
        }
    }
}
