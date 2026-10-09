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
 * @property {Promise<boolean> | null} loadPromise  the single-flight rehydrate
 * @property {Set<string>} inFlight  `walletId:entryId` claims of broadcasts on the network
 * @property {Set<string>} prunedWallets  walletIds removed before `loaded` latched,
 *   which the rehydrate merge skips and its write-back drops from the blob;
 *   each add is also written to a durable ledger so a worker evicted before
 *   the read recovers still drops the wallet on the next boot
 */

function serializeStorageWrites(storage) {
    if (!storage) return storage;
    let tail = Promise.resolve();
    const enqueue = (write) => {
        const run = tail.then(write);
        tail = run.catch(() => {});
        return run;
    };
    const wrapped = Object.create(storage);
    for (const method of ['save', 'saveSettlements', 'clear']) {
        if (typeof storage[method] !== 'function') continue;
        wrapped[method] = (...args) => enqueue(() => storage[method](...args));
    }
    return wrapped;
}

// Core owns the prefix so both wipe paths sweep exactly the keys written here.
const PRUNED_PREFIX = BROADCAST_QUEUE_PRUNED_PREFIX;

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
    const serializedStorage = serializeStorageWrites(storage);
    return {
        storage: ledger ? withLedger(serializedStorage, prunedWallets) : serializedStorage,
        queues: new Map(),
        owed: [],
        loaded: false,
        sealed: false,
        loadPromise: null,
        inFlight: new Set(),
        prunedWallets,
    };
}

/**
 * Replace a dormant store from persistence after its shell acquires an
 * exclusive writer lease. Both halves are read before live state changes, so
 * an unreadable queue or journal leaves the cache intact and writes gated.
 *
 * @param {BroadcastQueueStore | null} store
 * @returns {Promise<boolean>} whether the persisted state replaced the cache
 */
export async function refreshBroadcastQueueStore(store) {
    if (!store || store.sealed || !store.storage) return false;
    const previousLoad = store.loadPromise;
    if (previousLoad) {
        try { await previousLoad; } catch (_err) { /* retry from storage below */ }
    }
    if (store.sealed) return false;

    store.loaded = false;
    store.loadPromise = (async () => {
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
        store.queues.clear();
        for (const [walletId, entries] of Object.entries(snapshot)) {
            if (pruned?.has(walletId) || !Array.isArray(entries) || entries.length === 0) continue;
            const restorable = entries.filter((entry) => entry && typeof entry === 'object');
            if (restorable.length > 0) store.queues.set(walletId, restorable);
        }
        store.owed = settlements
            .filter((entry) => entry && typeof entry === 'object')
            .filter((entry) => !entry.walletId || !pruned?.has(entry.walletId))
            .map((entry) => ({ ...entry }));
        store.loaded = true;

        if (pruned?.size > 0) {
            const queues = {};
            for (const [walletId, entries] of store.queues.entries()) queues[walletId] = [...entries];
            try {
                await store.storage.save(queues);
                if (typeof store.storage.saveSettlements === 'function') {
                    await store.storage.saveSettlements(store.owed.map((entry) => ({ ...entry })));
                }
                pruned.clear();
            } catch (_err) {
                // Live state is complete; the durable prune ledger keeps the retry safe.
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
