// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A two-phase entry whose queue save was refused after the vault advanced its
// record to the reveal. The stored entry is one phase behind the record, so a
// reload must bring it forward before any retry, and a refusal must never turn
// the commit-landed record into 'failed'.

import { describe, it, expect, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const CHAIN = 'litecoin-regtest';
const W = 'w1';
const ADDR = 'rltc1qsrc';
const COMMIT = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const REVEAL = signedTxFor({
    inputs: [{ type: 'p2wpkh', txid: '0002'.repeat(16), vout: 1 }],
    outputs: [{ script: `0014${'dd'.repeat(20)}`, value: 89_000 }],
});

function memCollection() {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        update: async (id, decide) => {
            const next = decide(m.has(id) ? copy(m.get(id)) : null);
            if (next == null) return false;
            m.set(id, copy(next));
            return true;
        },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

const chainRegistry = {
    get: () => ({ id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }),
    list: () => [],
    chainIdFor: (coin, network) => (coin === 'litecoin' && network === 'regtest' ? CHAIN : null),
};

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function serializedCollection(seed, firstWriteGate) {
    let current = structuredClone(seed);
    let tail = Promise.resolve();
    let firstWrite = true;
    const enqueue = (operation) => {
        const result = tail.then(operation);
        tail = result.catch(() => {});
        return result;
    };
    return {
        get: async () => structuredClone(current),
        put: (record) => enqueue(async () => {
            if (firstWrite) {
                firstWrite = false;
                await firstWriteGate.promise;
            }
            current = structuredClone(record);
        }),
        update: (id, decide) => enqueue(() => {
            const next = decide(current?.id === id ? structuredClone(current) : null);
            if (next == null) return false;
            current = structuredClone(next);
            return true;
        }),
    };
}

function bootHost({ pendingTxs, broadcastTx, entries }) {
    const saved = [];
    const vault = {
        pendingTxs,
        wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
        accounts: { findBy: async (key, value) => (key === 'walletId' ? [{ id: `acct-${value}`, walletId: value }] : []) },
        addresses: { list: async () => [{ id: 'addr-a', accountId: `acct-${W}`, address: ADDR }] },
        settings: { get: vi.fn(async () => ({})), put: vi.fn(async () => {}) },
    };
    const tracker = trackerFor([...COMMIT.prevouts, ...REVEAL.prevouts], networks.regtest);
    const sdk = {
        encoder: { broadcastTx: vi.fn(broadcastTx), getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: {
            load: async () => ({ [W]: structuredClone(entries) }),
            save: async (snapshot) => { saved.push(structuredClone(snapshot)); },
            clear: async () => {},
        },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = async (type, request) => host.handle({ type, request });
    return {
        call,
        saved,
        list: async () => (await call('broadcast.queue.list', { walletId: W })).result,
        sent: () => sdk.encoder.broadcastTx.mock.calls.map(([hex]) => hex),
    };
}

// The entry as the last successful save left it: still the commit, with its reveal riding along.
const staleEntry = {
    id: 'A', chainId: CHAIN, signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1', summary: 'Deploy',
    signedAt: 1, pendingTxId: 'p1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
};
// The record after advanceToReveal wrote through: the reveal is owed, the commit landed.
const advancedRecord = (extra = {}) => ({
    id: 'p1', chain: 'litecoin', network: 'regtest', fromAddress: ADDR, status: 'broadcasting',
    txHex: REVEAL.txHex, txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
    revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
    createdAt: '2026-01-01T00:00:00.000Z', ...extra,
});

describe('a queue entry one phase behind its commit-landed record', () => {
    it('is rewritten to the reveal on the first list and the saved queue follows', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord());
        const h = bootHost({ pendingTxs, entries: [staleEntry], broadcastTx: async () => ({}) });

        const [entry] = await h.list();

        expect(entry).toMatchObject({
            id: 'A', signedTxHex: REVEAL.txHex, txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
            pendingTxId: 'p1', summary: 'Deploy',
        });
        expect(entry.revealTxHex).toBeUndefined();
        expect(entry.revealTxid).toBeUndefined();
        const last = h.saved.at(-1)[W][0];
        expect(last).toMatchObject({ signedTxHex: REVEAL.txHex, commitLanded: true, commitTxid: 'txid-PHASE1' });
        expect(last.revealTxHex).toBeUndefined();
    });

    it('sends the reveal alone when Broadcast now follows the list', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord());
        const h = bootHost({ pendingTxs, entries: [staleEntry], broadcastTx: async () => ({ txid: 'txid-PHASE2' }) });
        await h.list();

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(true);
        expect(h.sent()).toEqual([REVEAL.txHex]);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2', commitLanded: true });
        expect(await h.list()).toEqual([]);
    });

    it('sends the reveal alone when Broadcast now arrives before any list', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord());
        const h = bootHost({ pendingTxs, entries: [staleEntry], broadcastTx: async () => ({ txid: 'txid-PHASE2' }) });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(true);
        expect(h.sent()).toEqual([REVEAL.txHex]);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2' });
    });

    it('keeps the record broadcast on the commit when the reveal is permanently refused', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord());
        const h = bootHost({
            pendingTxs,
            entries: [staleEntry],
            broadcastTx: async () => { throw new Error('bad-txns-inputs-missingorspent'); },
        });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(false);
        expect(h.sent()).toEqual([REVEAL.txHex]);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE1', commitLanded: true });
    });

    it('is left alone when the record names a different commit', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord({ commitTxid: 'txid-OTHER' }));
        const h = bootHost({ pendingTxs, entries: [staleEntry], broadcastTx: async () => ({}) });

        const [entry] = await h.list();

        expect(entry).toMatchObject({ signedTxHex: COMMIT.txHex, revealTxHex: REVEAL.txHex });
        expect(entry.commitLanded).toBeUndefined();
    });

    it('is left alone when the record has not landed its commit', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord({
            status: 'queued', txHex: COMMIT.txHex, txid: 'txid-PHASE1', commitLanded: undefined, commitTxid: undefined,
        }));
        const h = bootHost({ pendingTxs, entries: [staleEntry], broadcastTx: async () => ({}) });

        const [entry] = await h.list();

        expect(entry).toMatchObject({ signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1', revealTxHex: REVEAL.txHex });
        expect(entry.commitLanded).toBeUndefined();
    });
});

describe('a permanent refusal settled against the durable record', () => {
    const engineOver = (pendingTxs) => ({
        vault: { pendingTxs },
        engine: createBroadcastQueueEngine({
            store: createBroadcastQueueStore({ storage: null }),
            importedAddressIdsFor: async () => new Set(),
            discardQueuedBroadcast: async () => {},
        }),
    });

    it('never writes failed over a record whose commit landed', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord());
        const { vault, engine } = engineOver(pendingTxs);

        const verdict = await engine.applyPendingTxPatch(vault, 'p1', { status: 'failed', error: 'spent' });

        expect(verdict).toBe('settled');
        expect(await pendingTxs.get('p1')).toMatchObject({
            status: 'broadcast', txid: 'txid-PHASE1', commitLanded: true, error: 'spent',
        });
    });

    it('does not replay a stale queued patch over an earlier terminal write', async () => {
        const gate = deferred();
        const pendingTxs = serializedCollection(advancedRecord(), gate);
        const { vault, engine } = engineOver(pendingTxs);
        const landed = pendingTxs.put({ ...advancedRecord(), status: 'broadcast', txid: 'landed-txid' });
        const replay = engine.applyPendingTxPatch(vault, 'p1', { status: 'queued', txid: null });

        gate.resolve();
        await landed;
        await expect(replay).resolves.toBe('closed');
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'landed-txid' });
    });

    it('still writes failed over a record whose commit never landed', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(advancedRecord({
            status: 'queued', txHex: COMMIT.txHex, txid: 'txid-PHASE1', commitLanded: undefined, commitTxid: undefined,
        }));
        const { vault, engine } = engineOver(pendingTxs);

        await engine.applyPendingTxPatch(vault, 'p1', { status: 'failed', error: 'spent' });

        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'failed', error: 'spent' });
    });
});
