// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A queue route retires an entry only after its PendingTx is terminal or journaled.
//
// A lock tears host 1 down while it broadcasts or discards E, and the unlock
// builds host 2 over the same shared store. Host 1's queue write is parked, so
// host 2 lists while host 1 sits between its two halves. The vault rebuild in
// that list reads the live queue and the journal to decide what nobody owns;
// an entry gone from the queue with nothing journaled yet reads as an orphan
// and comes back as a row for a transaction that already landed or was discarded.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';
const KEY = 'xchain.broadcastQueue';
const ADDR = 'bcrt1qowned';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** A chrome.storage.local double whose next write can be parked before it reports back. */
function stubChrome() {
    const store = {};
    let parked = null;
    vi.stubGlobal('chrome', {
        runtime: {},
        storage: {
            local: {
                get: (k, cb) => cb({ [k]: store[k] }),
                set: (items, cb) => {
                    Object.assign(store, JSON.parse(JSON.stringify(items)));
                    if (parked && !parked.cb) {
                        parked.cb = cb;
                        return;
                    }
                    cb();
                },
                remove: (k, cb) => { delete store[k]; cb(); },
            },
        },
    });
    return {
        store,
        parkNextWrite() { parked = { cb: null }; },
        releaseWrite() {
            const cb = parked?.cb;
            parked = null;
            if (cb) cb();
        },
    };
}

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
 * A vault over the shared table, owning ADDR, that refuses every PendingTx call once closed.
 * `holdClaimedRead` takes the first 'broadcasting' scan's rows at call time and
 * answers only once its promise settles, a read that went stale while it waited.
 */
function openVault(table, holdClaimedRead = null) {
    let closed = false;
    let held = holdClaimedRead;
    const guard = (fn) => async (...args) => {
        if (closed) throw new Error('VaultStateError: vault is closed');
        return fn(...args);
    };
    const findBy = async (k, v) => {
        const rows = await table.findBy(k, v);
        if (held && k === 'status' && v === 'broadcasting') {
            const hold = held;
            held = null;
            hold.started.resolve();
            await hold.promise;
        }
        return rows;
    };
    return {
        close: () => { closed = true; },
        vault: {
            pendingTxs: {
                get: guard(table.get),
                put: guard(table.put),
                list: guard(table.list),
                delete: guard(table.delete),
                find: guard(table.find),
                findBy: guard(findBy),
            },
            wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
            accounts: { findBy: async (k, v) => (k === 'walletId' ? [{ id: `acct-${v}`, walletId: v }] : []) },
            addresses: { list: async () => [{ id: 'addr-a', accountId: `acct-${W}`, address: ADDR }] },
            settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
        },
    };
}

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
        broadcastQueueStore: store,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return async (type, request) => host.handle({ type, request });
}

/** Host 1 holds E, the wallet locks (host 1's vault closes), and the unlock builds host 2. */
async function lockWithEQueued({ broadcastTx = vi.fn() } = {}) {
    const chrome = stubChrome();
    const table = pendingTxTable();
    chrome.store[KEY] = {
        queues: { [W]: [{ id: 'q-E', chainId: CHAIN, signedTxHex: 'hex-E', summary: 'E', signedAt: 1, pendingTxId: 'p-E' }] },
        settlements: [],
    };
    table.rows.set('p-E', {
        id: 'p-E', status: 'queued', txHex: 'hex-E', txid: null, fromAddress: ADDR,
        chain: 'bitcoin', network: 'regtest', createdAt: '2026-01-01T00:00:00.000Z',
    });
    const store = createBroadcastQueueStore({ storage: createBroadcastQueueStorage() });
    const v1 = openVault(table);
    const h1 = makeHost({ vault: v1.vault, broadcastTx, store });
    await settle();
    return { chrome, table, store, v1, h1 };
}

function hostTwo(table, store, holdClaimedRead = null) {
    return makeHost({ vault: openVault(table, holdClaimedRead).vault, broadcastTx: vi.fn(async () => 'txid-second-send'), store });
}

const rowsFor = (list, pendingTxId) => list.result.filter((e) => e.pendingTxId === pendingTxId);

afterEach(() => vi.unstubAllGlobals());

describe('queue routes settle the durable half before they drop the entry', () => {
    for (const [label, outcome, status] of [
        ['a landed broadcast', (gate) => gate.resolve('txid-E'), 'broadcast'],
        ['an already-known reply', (gate) => gate.reject(new Error('txn-already-known')), 'broadcast'],
        ['a permanent rejection', (gate) => gate.reject(new Error('bad-txns-inputs-missingorspent')), 'failed'],
    ]) {
        it(`the next host does not rebuild E while the torn-down host retires it after ${label}`, async () => {
            const gate = deferred();
            const { chrome, table, store, v1, h1 } = await lockWithEQueued({ broadcastTx: vi.fn(() => gate.promise) });
            const inFlight = h1('broadcast.queue.broadcast', { walletId: W, id: 'q-E' });
            await settle();
            expect(table.rows.get('p-E').status).toBe('broadcasting');
            v1.close();
            const h2 = hostTwo(table, store);
            await settle();

            chrome.parkNextWrite();
            outcome(gate);
            await settle();
            const during = await h2('broadcast.queue.list', { walletId: W });
            expect(during.ok).toBe(true);
            expect(rowsFor(during, 'p-E')).toEqual([]);

            chrome.releaseWrite();
            await inFlight;
            await settle();
            const after = await h2('broadcast.queue.list', { walletId: W });
            expect(rowsFor(after, 'p-E')).toEqual([]);
            expect(table.rows.get('p-E').status).toBe(status);
        });
    }

    it('the vault rebuild skips E when E is retired and its journal drained while the scan reads', async () => {
        const gate = deferred();
        const { table, store, v1, h1 } = await lockWithEQueued({ broadcastTx: vi.fn(() => gate.promise) });
        const inFlight = h1('broadcast.queue.broadcast', { walletId: W, id: 'q-E' });
        await settle();
        v1.close();
        const hold = { ...deferred(), started: deferred() };
        const h2 = hostTwo(table, store, hold);
        await settle();

        // Host 2's scan reads E as 'broadcasting' and parks before it checks what is held.
        const listing = h2('broadcast.queue.list', { walletId: W });
        await hold.started.promise;
        gate.resolve('txid-E');
        await inFlight;
        await settle();
        // Another list on host 2 drains the journal record host 1 wrote for E.
        await h2('broadcast.queue.list', { walletId: 'w-other' });
        expect(table.rows.get('p-E').status).toBe('broadcast');
        expect(store.owed).toEqual([]);
        hold.resolve();

        const during = await listing;
        expect(rowsFor(during, 'p-E')).toEqual([]);
        const after = await h2('broadcast.queue.list', { walletId: W });
        expect(rowsFor(after, 'p-E')).toEqual([]);
    });

    it('the next host does not rebuild E while the torn-down host discards it', async () => {
        const { chrome, table, store, v1, h1 } = await lockWithEQueued();
        v1.close();
        const h2 = hostTwo(table, store);
        await settle();

        chrome.parkNextWrite();
        const discarding = h1('broadcast.queue.discard', { walletId: W, id: 'q-E' });
        await settle();
        const during = await h2('broadcast.queue.list', { walletId: W });
        expect(rowsFor(during, 'p-E')).toEqual([]);

        chrome.releaseWrite();
        expect((await discarding).result).toEqual({ discarded: true });
        await settle();
        const after = await h2('broadcast.queue.list', { walletId: W });
        expect(rowsFor(after, 'p-E')).toEqual([]);
        expect(table.rows.has('p-E')).toBe(false);
    });
});
