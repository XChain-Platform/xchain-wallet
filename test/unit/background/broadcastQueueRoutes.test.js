// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host's queued-broadcast routes, driven through the real host object
// (§49.5). Three contracts, each of which the source-scanning smokes cannot
// see because they read text rather than run the route:
//
//   1. Removal after the network await is by entry id, and the entry is
//      claimed in-flight before the first await. `q` is the live array every
//      renderer context mutates through this one host, so a discard of a
//      lower entry (or a second broadcast) while `broadcastTx` is pending
//      shifts it; a splice by the index captured before the await would then
//      delete a different, still-valid signed transaction and leave the one
//      actually broadcast listed for a second press.
//   2. The ADS verdict submitAction hands over on a transient failure rides
//      the stored entry and is booked once the queued bytes land, never on
//      a failed attempt and never twice (§5.3.4: the queued tx is what
//      donates).
//   3. The PendingTx submitAction stamped 'queued' names itself on the entry
//      as `pendingTxId`; a successful queue broadcast moves it to 'broadcast',
//      a permanent rejection to 'failed', and Discard retires it. A record
//      left 'queued' after the bytes landed keeps netting the spend out of
//      the balance and never subscribes for its confirmation.
//   4. A settlement a closed vault refuses is journaled under the queue's own
//      storage key and replayed against the next vault that takes it. Removal
//      from the queue is what would otherwise strand the record for good, and
//      a second key would outlive the wipe, which clears by enumerated key.
//   5. A boot whose local store lost the queue rebuilds it from the durable
//      PendingTx records the signing flow stamped 'queued', bounded by an
//      ownership join so no wallet sees another's signed bytes, and by the
//      'broadcasting' claim so nothing that reached a node comes back.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueStorage } from '../../../packages/extension/src/background/broadcastQueueStorage.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';

function memCollection() {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

function adsSettings() {
    return {
        schemaVersion: 2,
        ads: {
            enabled: true,
            perChain: {
                [CHAIN]: {
                    accumulatedSats: 5000, triggerAmountSats: 1000, perTxAmountSats: 100,
                    lifetimeTxCount: 0, lifetimeDonatedSats: 0,
                },
            },
        },
    };
}

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/**
 * Build the host over a storage adapter whose `load()` yields the given
 * entries, which is the same path a persisted queue takes on rehydrate and
 * the only way to seed the queue with the fields submitAction supplies.
 */
function makeHost({
    entries = [], broadcastTx, settings = adsSettings(), storage: injected, pendingTxs,
    accounts, addresses, wallets,
} = {}) {
    let current = JSON.parse(JSON.stringify(settings));
    const vault = {
        pendingTxs: pendingTxs ?? memCollection(),
        // A vault double without accounts/addresses is a vault the reload
        // recovery cannot attribute a record to, so it restores nothing: that
        // is the fail-closed default every test below the recovery block wants.
        ...(accounts ? { accounts } : {}),
        ...(addresses ? { addresses } : {}),
        wallets: wallets ?? { list: async () => [{ id: W, name: 'Main' }] },
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(current))),
            put: vi.fn(async (r) => { current = JSON.parse(JSON.stringify(r)); }),
        },
    };
    const saved = [];
    const storage = injected ?? {
        load: async () => ({ [W]: entries }),
        save: async (snapshot) => { saved.push(JSON.parse(JSON.stringify(snapshot))); },
        clear: async () => {},
    };
    const sdk = { encoder: { broadcastTx } };
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN : null),
        },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: storage,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = async (type, request) => host.handle({ type, request });
    const list = async () => (await call('broadcast.queue.list', { walletId: W })).result;
    return { host, vault, call, list, saved, ads: () => current.ads.perChain[CHAIN] };
}

const entry = (id, extra = {}) => ({ id, chainId: CHAIN, signedTxHex: `hex-${id}`, summary: id, signedAt: 1, ...extra });

describe('broadcast.queue.broadcast removes by identity after the network await', () => {
    it('a discard of a lower entry during the broadcast removes the broadcast entry, not its neighbour', async () => {
        const gate = deferred();
        const broadcastTx = vi.fn(() => gate.promise);
        const h = makeHost({ entries: [entry('A'), entry('B'), entry('C')], broadcastTx });

        const inFlight = h.call('broadcast.queue.broadcast', { walletId: W, id: 'C' });
        // Let the handler reach the await on broadcastTx.
        await vi.waitFor(() => expect(broadcastTx).toHaveBeenCalledTimes(1));

        const discard = await h.call('broadcast.queue.discard', { walletId: W, id: 'A' });
        expect(discard.result).toEqual({ discarded: true });

        gate.resolve({ txid: 'tx-C' });
        const res = await inFlight;
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result.txid).toBe('tx-C');

        // C is gone (it broadcast) and B survived (it was never touched).
        expect((await h.list()).map((e) => e.id)).toEqual(['B']);
        expect(h.saved.at(-1)).toEqual({ [W]: [expect.objectContaining({ id: 'B' })] });
    });

    it('a permanent rejection also removes by identity', async () => {
        const gate = deferred();
        const broadcastTx = vi.fn(() => gate.promise);
        const h = makeHost({ entries: [entry('A'), entry('B'), entry('C')], broadcastTx });

        const inFlight = h.call('broadcast.queue.broadcast', { walletId: W, id: 'C' });
        await vi.waitFor(() => expect(broadcastTx).toHaveBeenCalledTimes(1));
        await h.call('broadcast.queue.discard', { walletId: W, id: 'A' });

        gate.reject(new Error('bad-txns-inputs-missingorspent'));
        const res = await inFlight;
        expect(res.ok).toBe(false);
        expect((await h.list()).map((e) => e.id)).toEqual(['B']);
    });

    it('a transient rejection leaves the entry queued', async () => {
        const broadcastTx = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        const h = makeHost({ entries: [entry('A')], broadcastTx });
        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(res.ok).toBe(false);
        expect((await h.list()).map((e) => e.id)).toEqual(['A']);
    });

    it('a second broadcast of the same entry fails before it reaches the network', async () => {
        const gate = deferred();
        const broadcastTx = vi.fn(() => gate.promise);
        const h = makeHost({ entries: [entry('A')], broadcastTx });

        const first = h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        const second = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(second.ok).toBe(false);
        expect(second.error.message).toMatch(/already being broadcast/);

        gate.resolve('tx-A');
        expect((await first).ok).toBe(true);
        expect(broadcastTx).toHaveBeenCalledTimes(1);

        // The claim is released with the handler: the entry is gone, so the
        // route now reports it missing rather than in flight.
        const third = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(third.error.message).toMatch(/no queued entry/);
    });
});

describe('broadcast.queue.broadcast books the ADS verdict the entry carries', () => {
    it('donationIncluded=true credits the prior accumulator once the bytes land', async () => {
        const h = makeHost({
            entries: [entry('A', { adsCommit: { chainId: CHAIN, donationIncluded: true } })],
            broadcastTx: vi.fn(async () => ({ txid: 'tx-A' })),
        });
        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(h.vault.settings.put).toHaveBeenCalledTimes(1);
        expect(h.ads()).toMatchObject({ lifetimeDonatedSats: 5000, accumulatedSats: 100, lifetimeTxCount: 1 });
    });

    it('donationIncluded=false advances the accumulator and the tx count only', async () => {
        const h = makeHost({
            entries: [entry('A', { adsCommit: { chainId: CHAIN, donationIncluded: false } })],
            broadcastTx: vi.fn(async () => 'tx-A'),
        });
        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(h.ads()).toMatchObject({ lifetimeDonatedSats: 0, accumulatedSats: 5100, lifetimeTxCount: 1 });
    });

    it('an entry with no verdict books nothing', async () => {
        const h = makeHost({ entries: [entry('A')], broadcastTx: vi.fn(async () => 'tx-A') });
        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(h.vault.settings.put).not.toHaveBeenCalled();
    });

    it('a failed broadcast books nothing and still surfaces the error', async () => {
        const h = makeHost({
            entries: [entry('A', { adsCommit: { chainId: CHAIN, donationIncluded: true } })],
            broadcastTx: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
        });
        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/ECONNREFUSED/);
        expect(h.vault.settings.put).not.toHaveBeenCalled();
    });

    it('a settings write failure never turns a landed broadcast into an error', async () => {
        const h = makeHost({
            entries: [entry('A', { adsCommit: { chainId: CHAIN, donationIncluded: true } })],
            broadcastTx: vi.fn(async () => 'tx-A'),
        });
        h.vault.settings.put.mockImplementation(async () => { throw new Error('vault locked'); });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
            expect(res.ok).toBe(true);
            expect(res.result.txid).toBe('tx-A');
            expect(await h.list()).toEqual([]);
        } finally {
            warn.mockRestore();
        }
    });
});

describe('the host queue settles the PendingTx half it was handed', () => {
    const queuedRecord = (id) => ({
        id, chain: 'bitcoin', network: 'regtest', status: 'queued', txHex: `hex-${id}`, txid: null, error: 'offline',
    });

    it('a successful broadcast moves the record from queued to broadcast', async () => {
        const h = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => ({ txid: 'tx-A' })),
        });
        await h.vault.pendingTxs.put(queuedRecord('p1'));
        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        const rec = await h.vault.pendingTxs.get('p1');
        expect(rec.status).toBe('broadcast');
        expect(rec.txid).toBe('tx-A');
        expect(rec.error).toBeNull();
        expect(typeof rec.broadcastAt).toBe('string');
    });

    it('a permanent rejection moves the record to failed; a transient one leaves it queued', async () => {
        const perm = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => { throw new Error('bad-txns-inputs-missingorspent'); }),
        });
        await perm.vault.pendingTxs.put(queuedRecord('p1'));
        await perm.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(await perm.vault.pendingTxs.get('p1')).toMatchObject({ status: 'failed', error: 'bad-txns-inputs-missingorspent' });

        const trans = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
        });
        await trans.vault.pendingTxs.put(queuedRecord('p1'));
        await trans.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect((await trans.vault.pendingTxs.get('p1')).status).toBe('queued');
    });

    it('discard retires the queued record', async () => {
        const h = makeHost({ entries: [entry('A', { pendingTxId: 'p1' })], broadcastTx: vi.fn() });
        await h.vault.pendingTxs.put(queuedRecord('p1'));
        const res = await h.call('broadcast.queue.discard', { walletId: W, id: 'A' });
        expect(res.result).toEqual({ discarded: true });
        expect(await h.vault.pendingTxs.get('p1')).toBeNull();
        expect(await h.list()).toEqual([]);
    });

    it('a record that already left queued is not rewritten', async () => {
        const h = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => 'tx-A'),
        });
        await h.vault.pendingTxs.put({ ...queuedRecord('p1'), status: 'indexed', txid: 'tx-A' });
        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect((await h.vault.pendingTxs.get('p1')).status).toBe('indexed');
    });

    it('an entry with no record (renderer enqueue) and a locked vault both still broadcast', async () => {
        const plain = makeHost({ entries: [entry('A')], broadcastTx: vi.fn(async () => 'tx-A') });
        expect((await plain.call('broadcast.queue.broadcast', { walletId: W, id: 'A' })).ok).toBe(true);

        const locked = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => 'tx-A'),
        });
        locked.vault.pendingTxs.get = async () => { throw new Error('VaultStateError: vault is closed'); };
        const res = await locked.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(res.ok).toBe(true);
        expect(await locked.list()).toEqual([]);
    });
});

describe('a settlement the vault refused survives the entry that owed it', () => {
    const queuedRecord = (id) => ({
        id, chain: 'bitcoin', network: 'regtest', status: 'queued', txHex: `hex-${id}`, txid: null, error: 'offline',
    });
    const KEY = 'xchain.broadcastQueue';

    /** chrome.storage.local double, callback-shaped like the real one. */
    function fakeChrome() {
        const store = {};
        return {
            store,
            api: {
                runtime: {},
                storage: {
                    local: {
                        get: (key, cb) => cb({ [key]: store[key] }),
                        set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); cb(); },
                        remove: (key, cb) => { delete store[key]; cb(); },
                    },
                },
            },
        };
    }

    it('a vault that will not take the write settles the record on the next list', async () => {
        const h = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => 'tx-A'),
        });
        await h.vault.pendingTxs.put(queuedRecord('p1'));
        const open = h.vault.pendingTxs.get;
        h.vault.pendingTxs.get = async () => { throw new Error('VaultStateError: vault is closed'); };

        // The bytes land and the entry leaves the queue, so nothing but the
        // journal still names the record the broadcast settles.
        expect((await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' })).ok).toBe(true);
        expect(await h.list()).toEqual([]);

        h.vault.pendingTxs.get = open;
        await h.list();
        const rec = await h.vault.pendingTxs.get('p1');
        expect(rec.status).toBe('broadcast');
        expect(rec.txid).toBe('tx-A');
        expect(rec.error).toBeNull();
    });

    it('a permanent rejection the vault refused reaches the record too', async () => {
        const h = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => { throw new Error('bad-txns-inputs-missingorspent'); }),
        });
        await h.vault.pendingTxs.put(queuedRecord('p1'));
        const open = h.vault.pendingTxs.get;
        h.vault.pendingTxs.get = async () => { throw new Error('VaultStateError: vault is closed'); };

        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        h.vault.pendingTxs.get = open;
        await h.list();
        expect(await h.vault.pendingTxs.get('p1')).toMatchObject({
            status: 'failed', error: 'bad-txns-inputs-missingorspent',
        });
    });

    it('a discard the vault refused still retires the record', async () => {
        const h = makeHost({ entries: [entry('A', { pendingTxId: 'p1' })], broadcastTx: vi.fn() });
        await h.vault.pendingTxs.put(queuedRecord('p1'));
        const open = h.vault.pendingTxs.get;
        h.vault.pendingTxs.get = async () => { throw new Error('VaultStateError: vault is closed'); };

        expect((await h.call('broadcast.queue.discard', { walletId: W, id: 'A' })).result)
            .toEqual({ discarded: true });

        h.vault.pendingTxs.get = open;
        await h.list();
        expect(await h.vault.pendingTxs.get('p1')).toBeNull();
    });

    it('the owed write survives a worker restart, under the queue key alone', async () => {
        const fake = fakeChrome();
        const prior = globalThis.chrome;
        globalThis.chrome = fake.api;
        try {
            fake.store[KEY] = { queues: { [W]: [entry('A', { pendingTxId: 'p1' })] } };
            const records = memCollection();
            await records.put(queuedRecord('p1'));

            const locked = makeHost({
                storage: createBroadcastQueueStorage(),
                pendingTxs: {
                    ...records,
                    get: async () => { throw new Error('VaultStateError: vault is closed'); },
                },
                broadcastTx: vi.fn(async () => 'tx-A'),
            });
            expect((await locked.call('broadcast.queue.broadcast', { walletId: W, id: 'A' })).ok).toBe(true);
            await new Promise((r) => setTimeout(r, 0));

            // The wallet wipe clears the local store by enumerated key, so the
            // journal has to share the key the queue already registers.
            expect(Object.keys(fake.store)).toEqual([KEY]);
            expect((await records.get('p1')).status).toBe('queued');

            // A fresh worker over the same store: the queue is empty, and the
            // journal is the only thing that still knows what the bytes did.
            const broadcastTx = vi.fn(async () => 'tx-A');
            const reopened = makeHost({
                storage: createBroadcastQueueStorage(),
                pendingTxs: records,
                broadcastTx,
            });
            expect(await reopened.list()).toEqual([]);
            expect(broadcastTx).not.toHaveBeenCalled();
            expect(await records.get('p1')).toMatchObject({ status: 'broadcast', txid: 'tx-A' });

            // The drained journal leaves nothing behind for the next boot.
            await new Promise((r) => setTimeout(r, 0));
            expect(fake.store[KEY].settlements).toEqual([]);
        } finally {
            if (prior === undefined) delete globalThis.chrome;
            else globalThis.chrome = prior;
        }
    });
});

describe('a failed rehydrate never lets the next mutation erase the persisted queue', () => {
    /**
     * Host over a storage double that can be switched between "unreadable"
     * and "readable", backed by a single mutable snapshot both the load and
     * the save see. Two wallets, because the erasure guarded against here is
     * cross-wallet: a failed read of A followed by an enqueue for B must never
     * write a snapshot in which A never existed.
     */
    function makeTwoWalletHost() {
        let readable = false;
        let backing = { w1: [entry('A1')] };
        const saves = [];
        const storage = {
            load: async () => {
                if (!readable) throw new Error('storage unreadable');
                return JSON.parse(JSON.stringify(backing));
            },
            save: async (snapshot) => {
                backing = JSON.parse(JSON.stringify(snapshot));
                saves.push(JSON.parse(JSON.stringify(snapshot)));
            },
            clear: async () => { backing = {}; },
        };
        const sdk = { encoder: { broadcastTx: vi.fn() } };
        const host = createBackgroundHost({
            vault: {
                pendingTxs: memCollection(),
                wallets: { list: async () => [{ id: 'w1' }, { id: 'w2' }] },
                settings: { get: async () => adsSettings(), put: async () => {} },
            },
            chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }), list: () => [] },
            sdkRegistry: { get: () => sdk, for: () => sdk },
            signerPool: { get: () => null, has: () => false },
            approvals: { request: async () => ({ approved: true }) },
            bridgeEvents: { emit() {} },
            getDiagnosticContext: () => ({}),
            broadcastQueueStorage: storage,
            signThrottleStorage: null,
            logConsoleStorage: null,
        });
        const call = async (type, request) => host.handle({ type, request });
        // pushQueueEntry persists fire-and-forget, so let the microtask and
        // timer queues drain before asserting on what storage received.
        const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
        return {
            call,
            settle,
            saves,
            backing: () => backing,
            recover: () => { readable = true; },
        };
    }

    it('skips the save while the read is failing, so wallet A survives an enqueue for wallet B', async () => {
        const h = makeTwoWalletHost();
        await h.settle();

        const res = await h.call('broadcast.queue.enqueue', {
            walletId: 'w2', chainId: CHAIN, signedTxHex: 'hex-B1', summary: 'B1',
        });
        expect(res.ok).toBe(true);
        await h.settle();

        // The mutation is live in this process...
        expect((await h.call('broadcast.queue.list', { walletId: 'w2' })).result).toHaveLength(1);
        // ...but nothing was written over the snapshot the failed read never
        // delivered. Before the fix the queue latched as "loaded" anyway and
        // this save landed as { w2: [B1] }, deleting wallet A's signed txs.
        expect(h.saves).toEqual([]);
        expect(h.backing()).toEqual({ w1: [entry('A1')] });
    });

    it('merges the recovered snapshot with the entries queued while degraded', async () => {
        const h = makeTwoWalletHost();
        await h.settle();
        await h.call('broadcast.queue.enqueue', {
            walletId: 'w2', chainId: CHAIN, signedTxHex: 'hex-B1', summary: 'B1',
        });
        await h.settle();

        h.recover();
        const w1 = (await h.call('broadcast.queue.list', { walletId: 'w1' })).result;
        expect(w1.map((e) => e.id)).toEqual(['A1']);

        // The next mutation now writes a snapshot holding BOTH wallets.
        await h.call('broadcast.queue.enqueue', {
            walletId: 'w2', chainId: CHAIN, signedTxHex: 'hex-B2', summary: 'B2',
        });
        await h.settle();
        expect(h.saves.length).toBeGreaterThan(0);
        const last = h.saves[h.saves.length - 1];
        expect(last.w1).toEqual([entry('A1')]);
        expect(last.w2.map((e) => e.signedTxHex)).toEqual(['hex-B1', 'hex-B2']);
    });

    it('retries the load on the next access instead of latching the dead read', async () => {
        const h = makeTwoWalletHost();
        await h.settle();
        expect((await h.call('broadcast.queue.list', { walletId: 'w1' })).result).toEqual([]);
        h.recover();
        expect((await h.call('broadcast.queue.list', { walletId: 'w1' })).result.map((e) => e.id))
            .toEqual(['A1']);
    });
});

describe('submitAction hands the queue what it needs to settle both halves', () => {
    it('names the PendingTx it stamped queued and carries the ADS verdict of the signed bytes', async () => {
        let settings = adsSettings();
        const vault = {
            pendingTxs: memCollection(),
            settings: {
                get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
                put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
            },
        };
        const sdk = {
            encoder: { createTx: vi.fn(), broadcastTx: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) },
            actions: { createAction: vi.fn() },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        };
        const signer = {
            kind: 'software',
            signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: 'txid-1' })),
        };
        const onBroadcastFailure = vi.fn(async () => {});
        await expect(submitAction({
            vault,
            walletId: W,
            chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest', adsDonationAddress: 'bcrt1qdonate' }) },
            sdkRegistry: { get: () => sdk },
            chainId: CHAIN,
            actionData: { action: 'ISSUE', params: { TICK: 'JDOG' } },
            encoderOpts: { pubkey: 'pub' },
            prebuiltPsbt: {
                psbtHex: 'PSBT', encoding: 'OP_RETURN', actionString: 'ISSUE|0|JDOG', version: 0,
                deferredFeeOutput: null, deferredOutputs: [], adsDonation: { included: true },
            },
            pendingTxMeta: { fromAddress: 'from', toAddress: 'to', actionSummary: 'Issue JDOG' },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
            onBroadcastFailure,
        })).rejects.toThrow();

        expect(onBroadcastFailure).toHaveBeenCalledTimes(1);
        const payload = onBroadcastFailure.mock.calls[0][0];
        const [record] = await vault.pendingTxs.list();
        expect(record.status).toBe('queued');
        expect(payload.pendingTxId).toBe(record.id);
        expect(payload.adsCommit).toEqual({ chainId: CHAIN, donationIncluded: true });
        // Nothing books on the failed attempt: the queued tx is what donates.
        expect(vault.settings.put).not.toHaveBeenCalled();
    });

    /**
     * The PendingTx record and the host queue are INDEPENDENT durability
     * halves. A failing vault write must not abort the catch block before the
     * enqueue runs: a broken vault would take the healthy half down with it
     * and hand the caller a storage error where the classified broadcast error
     * belongs.
     */
    function broadcastFailingSubmit({ putFails, broadcastError }) {
        const puts = [];
        const vault = {
            pendingTxs: {
                ...memCollection(),
                put: vi.fn(async (rec) => {
                    puts.push(JSON.parse(JSON.stringify(rec)));
                    if (putFails(rec)) throw new Error('VaultWriteError: disk full');
                }),
            },
            settings: { get: async () => adsSettings(), put: vi.fn(async () => {}) },
        };
        const sdk = {
            encoder: { createTx: vi.fn(), broadcastTx: vi.fn(async () => { throw broadcastError; }) },
            actions: { createAction: vi.fn() },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        };
        const onBroadcastFailure = vi.fn(async () => {});
        const run = () => submitAction({
            vault,
            walletId: W,
            chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }) },
            sdkRegistry: { get: () => sdk },
            chainId: CHAIN,
            actionData: { action: 'ISSUE', params: { TICK: 'JDOG' } },
            encoderOpts: { pubkey: 'pub' },
            prebuiltPsbt: {
                psbtHex: 'PSBT', encoding: 'OP_RETURN', actionString: 'ISSUE|0|JDOG', version: 0,
                deferredFeeOutput: null, deferredOutputs: [], adsDonation: null,
            },
            pendingTxMeta: { fromAddress: 'from', toAddress: 'to', actionSummary: 'Issue JDOG' },
            signer: {
                kind: 'software',
                signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: 'txid-1' })),
            },
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
            onBroadcastFailure,
        });
        return { run, onBroadcastFailure, puts };
    }

    it('still enqueues the signed bytes when the queued PendingTx write rejects', async () => {
        const h = broadcastFailingSubmit({
            putFails: (rec) => rec.status === 'queued',
            broadcastError: new Error('ECONNREFUSED'),
        });
        const err = await h.run().then(() => null, (e) => e);

        // The classified broadcast error is what the caller switches on; a
        // storage error here sends it down the re-compose branch instead.
        expect(err?.name).toBe('BroadcastFailedTransientError');
        expect(err.pendingTxWriteError).toMatch(/VaultWriteError/);
        // The independent half still ran, carrying the signed bytes.
        expect(h.onBroadcastFailure).toHaveBeenCalledTimes(1);
        expect(h.onBroadcastFailure.mock.calls[0][0].signedTxHex).toBe('TX(PSBT)');
    });

    it('keeps the permanent classification when the failed PendingTx write rejects', async () => {
        const h = broadcastFailingSubmit({
            putFails: (rec) => rec.status === 'failed',
            broadcastError: new Error('bad-txns-inputs-missingorspent'),
        });
        const err = await h.run().then(() => null, (e) => e);

        expect(err?.name).toBe('BroadcastFailedPermanentError');
        // A permanent rejection has nothing to queue, and that must not change.
        expect(h.onBroadcastFailure).not.toHaveBeenCalled();
    });
});

describe('a reload rebuilds the queue from the durable PendingTx half', () => {
    const A_ADDR = 'bcrt1qwallet-a';
    const B_ADDR = 'bcrt1qwallet-b';
    const W2 = 'w2';

    const queuedRecord = (id, fromAddress, extra = {}) => ({
        id,
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress,
        toAddress: 'bcrt1qdest',
        action: 'SEND',
        actionSummary: `Send from ${fromAddress}`,
        status: 'queued',
        txHex: `hex-${id}`,
        txid: null,
        error: 'ECONNREFUSED',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });

    /** Two wallets, one account and one address each: the ownership join's input. */
    const tables = () => ({
        wallets: {
            list: async () => [{ id: W }, { id: W2 }],
            get: async (id) => ({ id, importedKeys: [] }),
        },
        accounts: {
            findBy: async (key, value) => (key === 'walletId' ? [{ id: `acct-${value}`, walletId: value }] : []),
        },
        addresses: {
            list: async () => ([
                { id: 'addr-a', accountId: `acct-${W}`, address: A_ADDR },
                { id: 'addr-b', accountId: `acct-${W2}`, address: B_ADDR },
            ]),
        },
    });

    const withRecords = async (records) => {
        const store = memCollection();
        for (const r of records) await store.put(r);
        return store;
    };

    it('lists a signed transaction whose queue entry the local store never kept', async () => {
        const records = await withRecords([queuedRecord('p1', A_ADDR)]);
        const h = makeHost({ entries: [], pendingTxs: records, broadcastTx: vi.fn(), ...tables() });

        const listed = await h.list();
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
            chainId: CHAIN,
            signedTxHex: 'hex-p1',
            pendingTxId: 'p1',
            summary: `Send from ${A_ADDR}`,
        });
    });

    it('rebuilds only the records the asking wallet owns', async () => {
        const records = await withRecords([
            queuedRecord('p1', A_ADDR),
            queuedRecord('p2', B_ADDR),
        ]);
        const h = makeHost({ entries: [], pendingTxs: records, broadcastTx: vi.fn(), ...tables() });

        const mine = await h.list();
        expect(mine.map((e) => e.pendingTxId)).toEqual(['p1']);
        expect(mine.map((e) => e.signedTxHex)).toEqual(['hex-p1']);

        const theirs = (await h.call('broadcast.queue.list', { walletId: W2 })).result;
        expect(theirs.map((e) => e.pendingTxId)).toEqual(['p2']);
        expect(theirs.map((e) => e.signedTxHex)).toEqual(['hex-p2']);
    });

    it('restores nothing from a vault whose address tables it cannot read', async () => {
        const records = await withRecords([queuedRecord('p1', A_ADDR)]);
        const t = tables();
        const h = makeHost({
            entries: [],
            pendingTxs: records,
            broadcastTx: vi.fn(),
            ...t,
            addresses: { list: async () => { throw new Error('VaultStateError: vault is closed'); } },
        });

        expect(await h.list()).toEqual([]);
        // Un-latched, so the reconcile runs again once the table answers.
        h.vault.addresses.list = t.addresses.list;
        expect((await h.list()).map((e) => e.pendingTxId)).toEqual(['p1']);
    });

    it('does not rebuild an entry for bytes that already reached a node', async () => {
        const records = await withRecords([queuedRecord('p1', A_ADDR)]);
        // The claim before the network lands; the settlement after it does not,
        // which is the shape that leaves a broadcast transaction unsettled.
        const refusesAfterClaim = {
            ...records,
            put: async (rec) => {
                if (rec.status !== 'broadcasting') throw new Error('VaultStateError: vault is closed');
                return records.put(rec);
            },
        };
        const first = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            pendingTxs: refusesAfterClaim,
            broadcastTx: vi.fn(async () => 'tx-A'),
            ...tables(),
        });
        expect((await first.call('broadcast.queue.broadcast', { walletId: W, id: 'A' })).ok).toBe(true);
        expect((await records.get('p1')).status).toBe('broadcasting');

        // A fresh worker over an empty local store and the same vault.
        const broadcastTx = vi.fn(async () => 'tx-A');
        const reopened = makeHost({ entries: [], pendingTxs: records, broadcastTx, ...tables() });
        expect(await reopened.list()).toEqual([]);
        expect(broadcastTx).not.toHaveBeenCalled();
    });

    it('does not rebuild an entry the settlement journal still owes a write to', async () => {
        const records = await withRecords([queuedRecord('p1', A_ADDR)]);
        const h = makeHost({
            pendingTxs: {
                ...records,
                put: async () => { throw new Error('VaultStateError: vault is closed'); },
            },
            broadcastTx: vi.fn(),
            storage: {
                load: async () => ({}),
                save: async () => {},
                loadSettlements: async () => ([{
                    id: 's1', pendingTxId: 'p1', op: 'patch', patch: { status: 'broadcast', txid: 'tx-A' },
                }]),
                saveSettlements: async () => {},
                clear: async () => {},
            },
            ...tables(),
        });

        // The record still reads 'queued' only because the replay cannot land.
        expect(await h.list()).toEqual([]);
        expect((await records.get('p1')).status).toBe('queued');
    });

    it('rebuilds once, writes the entry back, and does not duplicate on a second list', async () => {
        const records = await withRecords([queuedRecord('p1', A_ADDR)]);
        const h = makeHost({ entries: [], pendingTxs: records, broadcastTx: vi.fn(), ...tables() });

        expect(await h.list()).toHaveLength(1);
        expect(await h.list()).toHaveLength(1);
        for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
        expect(h.saved.at(-1)[W]).toHaveLength(1);
    });

    it('the rebuilt entry broadcasts and settles the record it came from', async () => {
        const records = await withRecords([queuedRecord('p1', A_ADDR)]);
        const broadcastTx = vi.fn(async () => 'tx-p1');
        const h = makeHost({ entries: [], pendingTxs: records, broadcastTx, ...tables() });

        const [restored] = await h.list();
        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: restored.id });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(broadcastTx).toHaveBeenCalledWith('hex-p1');
        expect(await records.get('p1')).toMatchObject({ status: 'broadcast', txid: 'tx-p1' });
        expect(await h.list()).toEqual([]);
    });
});

describe('the broadcast route claims its record before the bytes go out', () => {
    const queuedRecord = (id) => ({
        id, chain: 'bitcoin', network: 'regtest', status: 'queued', txHex: `hex-${id}`, txid: null, error: 'offline',
    });

    it('the record reads broadcasting for the length of the network call', async () => {
        const gate = deferred();
        const h = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(() => gate.promise),
        });
        await h.vault.pendingTxs.put(queuedRecord('p1'));

        const inFlight = h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        await vi.waitFor(async () => {
            expect((await h.vault.pendingTxs.get('p1')).status).toBe('broadcasting');
        });

        gate.resolve('tx-A');
        expect((await inFlight).ok).toBe(true);
        expect(await h.vault.pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'tx-A' });
    });

    it('a transient rejection releases the claim back to queued', async () => {
        const h = makeHost({
            entries: [entry('A', { pendingTxId: 'p1' })],
            broadcastTx: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
        });
        await h.vault.pendingTxs.put(queuedRecord('p1'));

        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(await h.vault.pendingTxs.get('p1')).toMatchObject({
            status: 'queued', error: 'ECONNREFUSED',
        });
    });
});
