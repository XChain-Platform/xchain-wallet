// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A lock tears the host down while a queued broadcast is still on the network.
//
// The next unlock builds a second host, and the first one's broadcast then
// resolves late and persists. With a queue per host that late persist wrote the
// first host's stale queue over what the second had saved, and erased the
// settlement record the second host's open vault needed. The shell now hands
// every host one shared store; the negative control keeps a store per host and
// must still lose the second host's entry, which proves the race is reached.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';
import {
    createBroadcastQueueStore,
    sealBroadcastQueueStore,
} from '../../../packages/extension/src/background/broadcastQueueStore.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';
const KEY = 'xchain.broadcastQueue';

// Drain the fire-and-forget persists and timers before asserting on storage.
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

/** A chrome.storage.local double over one plain object. */
function stubChrome() {
    const store = {};
    vi.stubGlobal('chrome', {
        runtime: {},
        storage: {
            local: {
                get: (k, cb) => cb({ [k]: store[k] }),
                set: (items, cb) => { Object.assign(store, JSON.parse(JSON.stringify(items))); cb(); },
                remove: (k, cb) => { delete store[k]; cb(); },
            },
        },
    });
    return store;
}

/** The vault's PendingTx rows, one copy both hosts' vaults read, as on disk. */
function pendingTxTable() {
    const rows = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        rows,
        get: async (id) => (rows.has(id) ? copy(rows.get(id)) : null),
        put: async (rec) => { rows.set(rec.id, copy(rec)); },
        list: async () => Array.from(rows.values()).map(copy),
        delete: async (id) => rows.delete(id),
        find: async (id) => (rows.has(id) ? copy(rows.get(id)) : null),
        findBy: async (k, v) => Array.from(rows.values()).filter((r) => r[k] === v).map(copy),
    };
}

/**
 * A vault over the shared table that refuses every read and write once closed.
 * `hold` parks the read of one row until its promise settles.
 */
function openVault(table, hold = null) {
    let closed = false;
    const guard = (fn) => async (...args) => {
        if (closed) throw new Error('VaultStateError: vault is closed');
        return fn(...args);
    };
    const get = async (id) => {
        if (hold && id === hold.id) await hold.promise;
        return table.get(id);
    };
    return {
        close: () => { closed = true; },
        vault: {
            pendingTxs: {
                get: guard(get),
                put: guard(table.put),
                list: guard(table.list),
                delete: guard(table.delete),
                find: guard(table.find),
                findBy: guard(table.findBy),
            },
            wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
            accounts: { findBy: async () => [] },
            addresses: { list: async () => [] },
            settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
        },
    };
}

/**
 * One host as a shell builds it. `store` is the shared queue store; omitted,
 * the host gets its own adapter and state, which is the per-host negative control.
 */
function makeHost({ vault, broadcastTx, store }) {
    const sdk = { encoder: { broadcastTx } };
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }), list: () => [], chainIdFor: () => CHAIN },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        ...(store ? { broadcastQueueStore: store } : { broadcastQueueStorage: createBroadcastQueueStorage() }),
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return async (type, request) => host.handle({ type, request });
}

/**
 * Seed a signed transaction E queued before this worker started: the blob
 * holds its bytes and the vault its PendingTx reading 'queued'.
 */
function seedQueuedE(chromeStore, table) {
    chromeStore[KEY] = {
        queues: { [W]: [{ id: 'q-E', chainId: CHAIN, signedTxHex: 'hex-E', summary: 'E', signedAt: 1, pendingTxId: 'p-E' }] },
        settlements: [],
    };
    table.rows.set('p-E', { id: 'p-E', status: 'queued', txHex: 'hex-E', txid: null, createdAt: '2026-01-01T00:00:00.000Z' });
}

/**
 * Host 1 starts broadcasting E, the wallet locks (host 1's vault closes), and
 * the unlock builds host 2, which queues F. Returns the pieces to resolve and inspect.
 */
async function lockMidBroadcast({ shared }) {
    const chromeStore = stubChrome();
    const table = pendingTxTable();
    seedQueuedE(chromeStore, table);
    const store = shared ? createBroadcastQueueStore({ storage: createBroadcastQueueStorage() }) : undefined;
    const gate = deferred();
    const v1 = openVault(table);
    const h1 = makeHost({ vault: v1.vault, broadcastTx: vi.fn(() => gate.promise), store });
    await settle();
    const inFlight = h1('broadcast.queue.broadcast', { walletId: W, id: 'q-E' });
    await settle();
    expect(table.rows.get('p-E').status).toBe('broadcasting');

    v1.close();
    const v2 = openVault(table);
    const broadcastTx2 = vi.fn(async () => 'txid-second-send');
    const h2 = makeHost({ vault: v2.vault, broadcastTx: broadcastTx2, store });
    await settle();
    const f = await h2('broadcast.queue.enqueue', { walletId: W, chainId: CHAIN, signedTxHex: 'hex-F', summary: 'F' });
    expect(f.ok).toBe(true);
    expect(chromeStore[KEY].queues[W].map((x) => x.signedTxHex)).toContain('hex-F');
    return { chromeStore, table, store, gate, inFlight, h2, broadcastTx2 };
}

const storedHexes = (chromeStore) => (chromeStore[KEY]?.queues?.[W] ?? []).map((x) => x.signedTxHex);

afterEach(() => vi.unstubAllGlobals());

describe('broadcast queue across a lock and unlock', () => {
    it('negative control: a store per host loses the second host\'s entry to the late persist', async () => {
        const { chromeStore, gate, inFlight } = await lockMidBroadcast({ shared: false });
        gate.resolve('txid-E');
        await inFlight;
        await settle();
        expect(storedHexes(chromeStore)).not.toContain('hex-F');
    });

    it('a late resolve on the torn-down host keeps the next host\'s save and settles E', async () => {
        const { chromeStore, table, gate, inFlight, h2 } = await lockMidBroadcast({ shared: true });
        gate.resolve('txid-E');
        const res = await inFlight;
        expect(res.ok).toBe(true);
        await settle();

        // F survives on disk, and E left both the disk and the next host's list.
        expect(storedHexes(chromeStore)).toContain('hex-F');
        expect(storedHexes(chromeStore)).not.toContain('hex-E');
        // Host 1's vault was closed, so the landed write is journaled, not lost.
        const journal = chromeStore[KEY].settlements;
        expect(journal.map((s) => s.pendingTxId)).toEqual(['p-E']);
        expect(journal[0].patch.status).toBe('broadcast');
        expect(table.rows.get('p-E').status).toBe('broadcasting');

        // Host 2's open vault drains the journal: E reads 'broadcast', never 'failed'.
        const list = await h2('broadcast.queue.list', { walletId: W });
        expect(list.result.map((x) => x.signedTxHex)).toEqual(['hex-F']);
        expect(table.rows.get('p-E').status).toBe('broadcast');
        expect(table.rows.get('p-E').txid).toBe('txid-E');
        expect(chromeStore[KEY].settlements).toEqual([]);
    });

    it('the next host neither re-sends nor discards E while the torn-down host still broadcasts it', async () => {
        const { table, gate, inFlight, h2, broadcastTx2 } = await lockMidBroadcast({ shared: true });
        const again = await h2('broadcast.queue.broadcast', { walletId: W, id: 'q-E' });
        expect(again.ok).toBe(false);
        expect(again.error.message).toMatch(/already being broadcast/);
        expect(broadcastTx2).not.toHaveBeenCalled();

        await h2('broadcast.queue.discard', { walletId: W, id: 'q-E' });
        expect(table.rows.has('p-E')).toBe(true);

        gate.resolve('txid-E');
        await inFlight;
        await settle();
        await h2('broadcast.queue.list', { walletId: W });
        expect(table.rows.get('p-E').status).toBe('broadcast');
    });

    it('a journal record the torn-down host writes during the next host\'s flush survives it', async () => {
        const chromeStore = stubChrome();
        const table = pendingTxTable();
        seedQueuedE(chromeStore, table);
        // D landed under an earlier closed vault, so its write is already owed.
        table.rows.set('p-D', { id: 'p-D', status: 'queued', txHex: 'hex-D', txid: null, createdAt: '2026-01-01T00:00:00.000Z' });
        chromeStore[KEY].settlements = [{ id: 's-D', walletId: W, pendingTxId: 'p-D', op: 'patch', patch: { status: 'broadcast', txid: 'txid-D' }, recordedAt: 1 }];
        const store = createBroadcastQueueStore({ storage: createBroadcastQueueStorage() });
        const gate = deferred();
        const v1 = openVault(table);
        const h1 = makeHost({ vault: v1.vault, broadcastTx: vi.fn(() => gate.promise), store });
        await settle();
        const inFlight = h1('broadcast.queue.broadcast', { walletId: W, id: 'q-E' });
        await settle();
        v1.close();

        // Host 2's flush parks on D's read while host 1 journals E's landing.
        const holdD = deferred();
        const v2 = openVault(table, { id: 'p-D', promise: holdD.promise });
        const h2 = makeHost({ vault: v2.vault, broadcastTx: vi.fn(), store });
        const listing = h2('broadcast.queue.list', { walletId: W });
        await settle();
        gate.resolve('txid-E');
        await inFlight;
        await settle();
        holdD.resolve();
        await listing;
        await settle();

        expect(table.rows.get('p-D').status).toBe('broadcast');
        expect(chromeStore[KEY].settlements.map((s) => s.pendingTxId)).toEqual(['p-E']);
        await h2('broadcast.queue.list', { walletId: W });
        expect(table.rows.get('p-E').status).toBe('broadcast');
    });

    it('a wipe that seals the shared store keeps the late resolve off the removed key', async () => {
        const { chromeStore, store, gate, inFlight } = await lockMidBroadcast({ shared: true });
        await sealBroadcastQueueStore(store);
        delete chromeStore[KEY];
        gate.resolve('txid-E');
        await inFlight;
        await settle();
        expect(chromeStore[KEY]).toBeUndefined();

        // The renewed store the shell builds after the wipe starts empty.
        const fresh = createBroadcastQueueStore({ storage: createBroadcastQueueStorage() });
        const h3 = makeHost({ vault: openVault(pendingTxTable()).vault, broadcastTx: vi.fn(), store: fresh });
        await settle();
        const list = await h3('broadcast.queue.list', { walletId: W });
        expect(list.result).toEqual([]);
    });
});
