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

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
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
function makeHost({ entries = [], broadcastTx, settings = adsSettings() } = {}) {
    let current = JSON.parse(JSON.stringify(settings));
    const vault = {
        pendingTxs: memCollection(),
        wallets: { list: async () => [{ id: W, name: 'Main' }] },
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(current))),
            put: vi.fn(async (r) => { current = JSON.parse(JSON.stringify(r)); }),
        },
    };
    const saved = [];
    const storage = {
        load: async () => ({ [W]: entries }),
        save: async (snapshot) => { saved.push(JSON.parse(JSON.stringify(snapshot))); },
        clear: async () => {},
    };
    const sdk = { encoder: { broadcastTx } };
    const host = createBackgroundHost({
        vault,
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
});
