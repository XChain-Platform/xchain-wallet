// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The owed-settlement journal survives a queue-storage outage.
//
// `persistOwedSettlements` refuses to write while `queueLoaded` is false, and
// that refusal is correct: both halves ride one storage key, so a journal
// write issued before a successful read saves `{ queues: {}, settlements }`
// over every wallet's persisted entries. The durability the refusal owes back
// is the replay: `ensureQueueLoaded`'s success path writes the merged journal
// once the read recovers, so a settlement recorded during the outage reaches
// storage instead of dying with the service worker.
//
// The lane that reaches it is the auto-enqueue: a send whose broadcast fails
// pushes the signed bytes onto the queue carrying the `pendingTxId` of the
// PendingTx record it stamped 'queued', and that id is what a later broadcast
// owes a settlement to. `sendToken` is stubbed because the scenario is about
// storage, not signing.

import { describe, it, expect, vi } from 'vitest';

const stubs = vi.hoisted(() => ({ sendToken: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, sendToken: (...args) => stubs.sendToken(...args) },
    };
});

const { createBackgroundHost } = await import(
    '../../../packages/extension/src/background/createBackgroundHost.js'
);

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
        ads: { enabled: false, perChain: {} },
    };
}

/**
 * A host over a storage double whose read can be switched from failing to
 * working, backed by one blob for both halves, and a vault whose PendingTx
 * reads refuse. `withJournal: false` drops the journal verbs from the adapter,
 * which is the negative control: the same outage, with nothing able to replay.
 */
function makeJournalHost({ withJournal = true } = {}) {
    let readable = false;
    let queues = { [W]: [] };
    let settlements = [];
    const settlementSaves = [];
    const journalVerbs = {
        loadSettlements: async () => {
            if (!readable) throw new Error('storage unreadable');
            return JSON.parse(JSON.stringify(settlements));
        },
        saveSettlements: async (owed) => {
            settlements = JSON.parse(JSON.stringify(owed));
            settlementSaves.push(JSON.parse(JSON.stringify(owed)));
        },
    };
    const storage = {
        load: async () => {
            if (!readable) throw new Error('storage unreadable');
            return JSON.parse(JSON.stringify(queues));
        },
        save: async (snapshot) => { queues = JSON.parse(JSON.stringify(snapshot)); },
        clear: async () => { queues = {}; settlements = []; },
        ...(withJournal ? journalVerbs : {}),
    };
    const pendingTxs = {
        ...memCollection(),
        get: async () => { throw new Error('VaultStateError: vault is closed'); },
    };
    const sdk = { encoder: { broadcastTx: vi.fn(async () => 'tx-A') } };
    const host = createBackgroundHost({
        vault: {
            pendingTxs,
            wallets: { list: async () => [{ id: W }] },
            settings: { get: async () => adsSettings(), put: async () => {} },
        },
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
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
    // pushQueueEntry and the journal write are fire-and-forget, so drain the
    // microtask and timer queues before asserting on what storage received.
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
    return {
        call,
        settle,
        settlementSaves,
        journal: () => settlements,
        recover: () => { readable = true; },
    };
}

/**
 * Drive the auto-enqueue lane: a send whose broadcast failed queues its bytes.
 * Returns the queue id the host minted for the entry.
 */
async function queueThroughFailedSend(h, { pendingTxId = 'p1' } = {}) {
    stubs.sendToken.mockImplementationOnce(async (opts) => {
        await opts.onBroadcastFailure({
            chainId: CHAIN, signedTxHex: 'hex-A', summary: 'A', signedAt: 1, pendingTxId,
        });
        throw new Error('ECONNREFUSED');
    });
    await h.call('action.send', { walletId: W, chainId: CHAIN });
    await h.settle();
    const listed = (await h.call('broadcast.queue.list', { walletId: W })).result;
    expect(listed.map((e) => e.pendingTxId)).toEqual([pendingTxId]);
    return listed[0].id;
}

describe('a settlement owed during a storage outage reaches the journal on recovery', () => {
    it('writes the deferred journal once the read recovers', async () => {
        const h = makeJournalHost();
        const id = await queueThroughFailedSend(h);

        // The bytes land and the entry leaves the queue, so nothing but the
        // journal still names the record the broadcast settles. Storage is
        // unreadable, so the journal write is refused rather than erasing the
        // persisted queue half it cannot see.
        expect((await h.call('broadcast.queue.broadcast', { walletId: W, id })).ok).toBe(true);
        await h.settle();
        expect(h.settlementSaves).toEqual([]);

        // The read recovers. The vault is still closed, so the flush settles
        // nothing and returns before its own persist: the load path is the only
        // thing that can write here.
        h.recover();
        await h.call('broadcast.queue.list', { walletId: W });
        await h.settle();

        expect(h.settlementSaves.length).toBeGreaterThan(0);
        expect(h.journal()).toEqual([expect.objectContaining({ pendingTxId: 'p1', walletId: W })]);
    });

    it('leaves the journal unwritten when the adapter carries no journal verbs', async () => {
        const h = makeJournalHost({ withJournal: false });
        const id = await queueThroughFailedSend(h, { pendingTxId: 'p2' });

        expect((await h.call('broadcast.queue.broadcast', { walletId: W, id })).ok).toBe(true);
        await h.settle();

        h.recover();
        await h.call('broadcast.queue.list', { walletId: W });
        await h.settle();

        // The same outage and the same recovery, with nothing able to replay:
        // this is what the assertion above looks like when it fails, which is
        // how that assertion is known not to be vacuous.
        expect(h.settlementSaves).toEqual([]);
        expect(h.journal()).toEqual([]);
    });
});
