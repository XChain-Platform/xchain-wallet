// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Durability of the queued-broadcast surface, driven through the real host:
//
//   1. A renderer enqueue names no PendingTx, so the blob is its only copy,
//      and the route replies only once that write has landed.
//   2. Discarding a resumed claim retires its 'broadcasting' record, so the
//      spend stops netting and the next boot does not rebuild the row. A
//      broadcast of the same entry still in flight keeps its record.
//   3. The vault-backed rebuild runs while the blob is unreadable, writes
//      nothing back, and collapses into the blob copy once the read recovers.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';
const A_ADDR = 'bcrt1qwallet-a';

function memCollection() {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const record = (id, extra = {}) => ({
    id,
    chain: 'bitcoin',
    network: 'regtest',
    fromAddress: A_ADDR,
    action: 'SEND',
    actionSummary: `Send ${id}`,
    status: 'queued',
    txHex: `hex-${id}`,
    txid: `tx-${id}`,
    error: 'ECONNREFUSED',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
});

/** A host whose vault can attribute A_ADDR to wallet W. */
function makeHost({ storage, pendingTxs = memCollection(), broadcastTx = vi.fn() } = {}) {
    const sdk = { encoder: { broadcastTx } };
    const host = createBackgroundHost({
        vault: {
            pendingTxs,
            wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
            accounts: { findBy: async (k, v) => (k === 'walletId' ? [{ id: `acct-${v}`, walletId: v }] : []) },
            addresses: { list: async () => [{ id: 'addr-a', accountId: `acct-${W}`, address: A_ADDR }] },
            settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
        },
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
        broadcastQueueStorage: storage ?? { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = async (type, request) => host.handle({ type, request });
    const list = async () => (await call('broadcast.queue.list', { walletId: W })).result;
    return { call, list, pendingTxs };
}

/** Storage whose read fails until `recover()`, over one blob both halves see. */
function flakyStorage(initial) {
    let readable = false;
    let backing = JSON.parse(JSON.stringify(initial));
    const saves = [];
    return {
        saves,
        recover: () => { readable = true; },
        adapter: {
            load: async () => {
                if (!readable) throw new Error('storage unreadable');
                return JSON.parse(JSON.stringify(backing));
            },
            save: async (snapshot) => {
                backing = JSON.parse(JSON.stringify(snapshot));
                saves.push(backing);
            },
            clear: async () => { backing = {}; },
        },
    };
}

describe('a renderer enqueue replies after its only durable copy is written', () => {
    it('holds the reply until the queue save resolves', async () => {
        const gate = deferred();
        const saves = [];
        const storage = {
            load: async () => ({}),
            save: (snapshot) => { saves.push(JSON.parse(JSON.stringify(snapshot))); return gate.promise; },
            clear: async () => {},
        };
        const h = makeHost({ storage });
        await settle();

        let replied = false;
        const pending = h.call('broadcast.queue.enqueue', {
            walletId: W, chainId: CHAIN, signedTxHex: 'hex-R', summary: 'R',
        }).then((res) => { replied = true; return res; });
        await settle();

        expect(saves.at(-1)[W].map((e) => e.signedTxHex)).toEqual(['hex-R']);
        expect(replied).toBe(false);

        gate.resolve();
        const res = await pending;
        expect(res.ok).toBe(true);
        expect(res.result.signedTxHex).toBe('hex-R');
    });
});

describe('discarding a resumed claim retires its record', () => {
    const claimed = async () => {
        const records = memCollection();
        await records.put(record('p1', { status: 'broadcasting' }));
        return records;
    };

    it('removes the broadcasting record, and a fresh worker does not rebuild the row', async () => {
        const records = await claimed();
        const h = makeHost({ pendingTxs: records });
        const [row] = await h.list();
        expect(row.resumedClaim).toBe(true);

        const res = await h.call('broadcast.queue.discard', { walletId: W, id: row.id });
        expect(res.result).toEqual({ discarded: true });
        expect(await records.get('p1')).toBeNull();

        const reopened = makeHost({ pendingTxs: records });
        expect(await reopened.list()).toEqual([]);
    });

    it('a discard the locked vault refused retires the claim once the vault reopens', async () => {
        const records = await claimed();
        const h = makeHost({ pendingTxs: records });
        const [row] = await h.list();
        const open = records.get;
        records.get = async () => { throw new Error('VaultStateError: vault is closed'); };

        await h.call('broadcast.queue.discard', { walletId: W, id: row.id });
        expect((await open('p1')).status).toBe('broadcasting');

        records.get = open;
        await h.list();
        expect(await records.get('p1')).toBeNull();
    });

    it('leaves the record to a broadcast of the same entry still in flight', async () => {
        const records = memCollection();
        await records.put(record('p1'));
        const gate = deferred();
        const h = makeHost({ pendingTxs: records, broadcastTx: vi.fn(() => gate.promise) });
        const [row] = await h.list();

        const inFlight = h.call('broadcast.queue.broadcast', { walletId: W, id: row.id });
        await vi.waitFor(async () => { expect((await records.get('p1')).status).toBe('broadcasting'); });
        await h.call('broadcast.queue.discard', { walletId: W, id: row.id });
        expect((await records.get('p1')).status).toBe('broadcasting');

        gate.resolve('tx-p1');
        expect((await inFlight).ok).toBe(true);
        expect(await records.get('p1')).toMatchObject({ status: 'broadcast', txid: 'tx-p1' });
    });
});

describe('the vault rebuild runs while the queue blob is unreadable', () => {
    const blobTwin = (extra = {}) => ({
        id: 'blob-1',
        chainId: CHAIN,
        signedTxHex: 'hex-p1',
        summary: 'Send p1',
        signedAt: 1,
        pendingTxId: 'p1',
        adsCommit: { chainId: CHAIN, donationIncluded: true },
        ...extra,
    });

    it('lists the vault record while the read fails, and writes nothing back', async () => {
        const records = memCollection();
        await records.put(record('p1'));
        const store = flakyStorage({ [W]: [blobTwin()] });
        const h = makeHost({ storage: store.adapter, pendingTxs: records });

        const listed = await h.list();
        expect(listed.map((e) => e.pendingTxId)).toEqual(['p1']);
        await settle();
        expect(store.saves).toEqual([]);
    });

    it('collapses into the blob copy once the read recovers, keeping its ADS verdict', async () => {
        const records = memCollection();
        await records.put(record('p1'));
        const store = flakyStorage({ [W]: [blobTwin()] });
        const h = makeHost({ storage: store.adapter, pendingTxs: records });
        const [degraded] = await h.list();

        store.recover();
        const recovered = await h.list();
        expect(recovered).toHaveLength(1);
        expect(recovered[0].id).toBe(degraded.id);
        expect(recovered[0].adsCommit).toEqual({ chainId: CHAIN, donationIncluded: true });
        await settle();
        expect(store.saves.at(-1)[W]).toHaveLength(1);
    });

    it('keeps the resumed-claim label across the recovery', async () => {
        const records = memCollection();
        await records.put(record('p1', { status: 'broadcasting' }));
        const store = flakyStorage({ [W]: [blobTwin()] });
        const h = makeHost({ storage: store.adapter, pendingTxs: records });
        expect((await h.list())[0].resumedClaim).toBe(true);

        store.recover();
        const recovered = await h.list();
        expect(recovered).toHaveLength(1);
        expect(recovered[0].resumedClaim).toBe(true);
    });

    it('still merges a blob entry with no PendingTx by id alone', async () => {
        const records = memCollection();
        await records.put(record('p1'));
        const psbtLane = { id: 'psbt-1', chainId: CHAIN, signedTxHex: 'hex-psbt', summary: 'PSBT', signedAt: 1 };
        const store = flakyStorage({ [W]: [psbtLane, blobTwin()] });
        const h = makeHost({ storage: store.adapter, pendingTxs: records });
        await h.list();

        store.recover();
        const ids = (await h.list()).map((e) => e.signedTxHex).sort();
        expect(ids).toEqual(['hex-p1', 'hex-psbt']);
    });
});
