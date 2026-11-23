// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A two-phase pair whose commit was refused at submit waits in the extension's
// retry queue with its donation claim held. "Broadcast now" sends the commit and
// then the reveal, and books the landed commit as its own transaction, as the
// live send does: an envelope commit settles the payout it carried, so a reveal
// refused for good or discarded afterwards cannot release a claim the chain
// already paid, and the next send never pays the queue a second time.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';

const submitWithSignerMock = vi.fn();
vi.mock('../../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { createBackgroundHost } = await import('../../../../packages/extension/src/background/createBackgroundHost.js');
const { submitAction } = await import('../../../../packages/core/src/flows/submitAction.js');
const { BroadcastFailedError } = await import('../../../../packages/core/src/sdk/submitWithSigner.js');
const { MAINNET_LAUNCH_EPOCH } = await import('../../../../packages/core/src/flows/mainnetPrelaunch.js');
const { createDefaultSettings } = await import('../../../../packages/core/src/schemas/settings.js');
const { signedTxFor, trackerFor } = await import('../../../helpers/signedTx.js');

const W = 'w1';
const MAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qsource';
const ENVELOPE = 'TAPROOT';
const CHUNK = 'P2SH';
const PERMANENT = 'rejected: bad-txns-inputs-missingorspent';
const COMMIT = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const REVEAL = signedTxFor({
    inputs: [{ type: 'p2wpkh', txid: '0002'.repeat(16), vout: 1 }],
    outputs: [{ script: `0014${'dd'.repeat(20)}`, value: 89_000 }],
});
const chainRegistry = {
    get: (id) => (id === MAIN ? { id: MAIN, coin: 'bitcoin', networkKind: 'mainnet' } : undefined),
    list: () => [],
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'mainnet' ? MAIN : null),
};

function memCollection(refuseUpdate = () => false) {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        update: async (id, decide) => {
            const next = decide(m.has(id) ? copy(m.get(id)) : null);
            if (next == null) return false;
            if (refuseUpdate(next)) throw new Error('refused pending update');
            m.set(id, copy(next));
            return true;
        },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

function walletVault() {
    const base = createDefaultSettings();
    let refuseAdvance = false;
    let settings = {
        ...base,
        fiatCurrency: 'USD',
        ads: {
            ...base.ads, currency: 'USD', perTransaction: '0.05', sendAt: '5', queued: '30',
            reserved: { id: 'review-1', fiat: '30', currency: 'USD', chainId: MAIN, pendingTxId: null, at: 1, review: true },
        },
    };
    const vault = {
        pendingTxs: memCollection((next) => {
            if (!refuseAdvance || next?.commitLanded !== true) return false;
            refuseAdvance = false;
            return true;
        }),
        wallets: {
            get: async (id) => (id === W ? { id: W, name: 'Main', importedAddressIds: [] } : null),
            list: async () => [{ id: W, name: 'Main', importedAddressIds: [] }],
        },
        accounts: { findBy: async () => [{ id: 'account-1', walletId: W }] },
        addresses: { list: async () => [{ id: 'address-1', accountId: 'account-1', address: SOURCE }] },
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
            put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
        },
    };
    return { vault, ads: () => settings.ads, refuseAdvanceOnce: () => { refuseAdvance = true; } };
}

function queueBlob() {
    const blob = { [W]: [] };
    return {
        blob,
        storage: {
            load: async () => JSON.parse(JSON.stringify(blob)),
            save: async (snapshot) => { Object.assign(blob, JSON.parse(JSON.stringify(snapshot))); },
            clear: async () => {},
        },
        enqueue: vi.fn(async (payload) => {
            blob[W].push({ id: `q-${blob[W].length + 1}`, ...JSON.parse(JSON.stringify(payload)) });
            return true;
        }),
    };
}

function makeHost(vault, storage, broadcastTx) {
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
        broadcastQueueStorage: storage,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = (type, request) => host.handle({ type, request });
    return { call, sent: () => sdk.encoder.broadcastTx.mock.calls.map(([hex]) => hex) };
}

// The commit is refused for a temporary reason, so the pair is queued whole
// with its signed reveal and the claim stays held on the queue. With
// `handedToQueue: false` the queue refused the hand-off, so only the PendingTx
// holds the pair and a host rebuilds its entry from that record.
async function queuePair(w, q, encoding, { handedToQueue = true } = {}) {
    submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
        onProgress('signing', { encoding });
        await onProgress('broadcasting', {
            txid: 'txid-commit', txHex: COMMIT.txHex, revealTxid: 'txid-reveal', revealTxHex: REVEAL.txHex,
        });
        throw new BroadcastFailedError({
            cause: new Error('connection reset'), signedTxHex: COMMIT.txHex, txid: 'txid-commit', chainId: MAIN,
            signedAt: 1, encoding, phase: 'phase1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-reveal',
        });
    });
    await expect(submitAction({
        vault: w.vault,
        walletId: W,
        chainRegistry,
        sdkRegistry: {},
        chainId: MAIN,
        actionData: { action: 'ISSUE', params: { TICK: 'AAA' } },
        encoderOpts: { pubkey: '02aa' },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        signer: { kind: 'software', lock() {} },
        pendingTxMeta: { fromAddress: SOURCE, toAddress: null, actionSummary: 'Issue' },
        prebuiltPsbt: { psbtHex: 'aa', adsDonation: { included: true, fiat: '30', currency: 'USD', reservationId: 'review-1' } },
        onBroadcastFailure: q.enqueue,
    })).rejects.toBeInstanceOf(BroadcastFailedError);
    const [record] = await w.vault.pendingTxs.list();
    expect(record).toMatchObject({ status: 'queued', revealTxHex: REVEAL.txHex, adsCommit: { encoding, reservationId: record.id } });
    if (handedToQueue) {
        expect(q.blob[W]).toHaveLength(1);
        expect(q.blob[W][0]).toMatchObject({ revealTxHex: REVEAL.txHex, adsCommit: { encoding, reservationId: record.id } });
    }
    expect(w.ads().reserved).toMatchObject({ id: record.id });
    return record;
}

const revealAnswer = (answer) => async (hex) => {
    if (hex === REVEAL.txHex) return answer();
    return { txid: 'txid-commit' };
};

beforeEach(() => {
    submitWithSignerMock.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue((MAINNET_LAUNCH_EPOCH + 86_400) * 1000);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('broadcast.queue books the commit of a queued two-phase pair', () => {
    for (const encoding of [ENVELOPE, CHUNK]) {
        it(`accrues both legs and settles the payout once when a queued ${encoding} pair lands`, async () => {
            const w = walletVault();
            const q = queueBlob();
            const record = await queuePair(w, q, encoding);
            const host = makeHost(w.vault, q.storage, revealAnswer(() => ({ txid: 'txid-reveal' })));
            const res = await host.call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
            expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
            expect(host.sent()).toEqual([COMMIT.txHex, REVEAL.txHex]);
            expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
            expect(w.ads().reserved).toBeUndefined();
            expect(w.ads().bookedKeys.queuedDelivery).toEqual(expect.arrayContaining([record.id, `${record.id}:commit`]));
        });
    }

    it('keeps the payout an envelope commit carried when the reveal is refused for good', async () => {
        const w = walletVault();
        const q = queueBlob();
        const record = await queuePair(w, q, ENVELOPE);
        const host = makeHost(w.vault, q.storage, revealAnswer(() => { throw new Error(PERMANENT); }));
        const res = await host.call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok).toBe(false);
        expect(await w.vault.pendingTxs.get(record.id)).toMatchObject({ status: 'broadcast', commitLanded: true });
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('settles the claim when a chunk-lane reveal is refused after its commit lands', async () => {
        const w = walletVault();
        const q = queueBlob();
        await queuePair(w, q, CHUNK);
        const host = makeHost(w.vault, q.storage, revealAnswer(() => { throw new Error(PERMANENT); }));
        const res = await host.call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok).toBe(false);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('keeps the payout an envelope commit carried when a pair rebuilt from its record is refused', async () => {
        const w = walletVault();
        const q = queueBlob();
        q.enqueue.mockImplementation(async () => false);
        const record = await queuePair(w, q, ENVELOPE, { handedToQueue: false });
        expect(q.blob[W]).toHaveLength(0);
        const host = makeHost(w.vault, q.storage, revealAnswer(() => { throw new Error(PERMANENT); }));
        const listed = await host.call('broadcast.queue.list', { walletId: W });
        expect(listed.ok, JSON.stringify(listed.error ?? {})).toBe(true);
        expect(q.blob[W]).toHaveLength(1);
        expect(q.blob[W][0]).toMatchObject({ pendingTxId: record.id, adsCommit: { encoding: ENVELOPE } });
        const res = await host.call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok).toBe(false);
        expect(host.sent()).toEqual([COMMIT.txHex, REVEAL.txHex]);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('keeps the payout an envelope commit carried when its waiting reveal is discarded', async () => {
        const w = walletVault();
        const q = queueBlob();
        const record = await queuePair(w, q, ENVELOPE);
        const host = makeHost(w.vault, q.storage, revealAnswer(() => { throw new Error('connection reset'); }));
        const id = q.blob[W][0].id;
        expect((await host.call('broadcast.queue.broadcast', { walletId: W, id })).ok).toBe(false);
        expect(q.blob[W][0]).toMatchObject({ commitLanded: true, adsCommit: { donationIncluded: false } });
        // The record carries the same verdict, so a queue rebuilt from it books the reveal accrue-only.
        expect(await w.vault.pendingTxs.get(record.id)).toMatchObject({
            commitLanded: true, adsCommit: { donationIncluded: false, reservationId: null, encoding: ENVELOPE },
        });
        const res = await host.call('broadcast.queue.discard', { walletId: W, id });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('journals the accrue-only verdict when the advance record write is refused', async () => {
        const w = walletVault();
        const q = queueBlob();
        const record = await queuePair(w, q, ENVELOPE);
        w.refuseAdvanceOnce();
        const host = makeHost(w.vault, q.storage, revealAnswer(() => { throw new Error('connection reset'); }));
        expect((await host.call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id })).ok).toBe(false);

        await host.call('broadcast.queue.list', { walletId: W });
        expect(await w.vault.pendingTxs.get(record.id)).toMatchObject({
            commitLanded: true, adsCommit: { donationIncluded: false, reservationId: null, encoding: ENVELOPE },
        });
    });

    it('journals the accrue-only verdict without either signed transaction', async () => {
        const w = walletVault();
        const q = queueBlob();
        const record = await queuePair(w, q, ENVELOPE);
        const writes = [];
        const storage = {
            ...q.storage,
            loadSettlements: async () => [],
            saveSettlements: async (next) => { writes.push(JSON.parse(JSON.stringify(next))); },
        };
        w.refuseAdvanceOnce();
        const host = makeHost(w.vault, storage, revealAnswer(() => { throw new Error('connection reset'); }));
        expect((await host.call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id })).ok).toBe(false);

        const owed = writes.flat().filter((s) => s.pendingTxId === record.id);
        expect(owed.some((s) => s.op === 'reveal' && s.patch?.adsCommit?.donationIncluded === false)).toBe(true);
        expect(JSON.stringify(writes)).not.toContain(COMMIT.txHex);
        expect(JSON.stringify(writes)).not.toContain(REVEAL.txHex);
    });
});
