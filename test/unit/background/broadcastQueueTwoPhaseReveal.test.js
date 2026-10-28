// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host's queued-broadcast lane for a two-phase P2SH or P2WSH action. The
// submit checkpoints the commit and its signed reveal before the commit goes
// out, so a reload that finds the record rebuilds one queue entry for both, and
// "Broadcast now" sends the commit and then the reveal: never the commit alone,
// which spends its coin into a script that nothing opens.

import { describe, it, expect, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const CHAIN = 'litecoin-regtest';
const W = 'w1';
const ADDR = 'rltc1qsrc';
const COMMIT = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const REVEAL = signedTxFor({
    inputs: [{ type: 'p2wpkh' }],
    outputs: [{ script: `0014${'dd'.repeat(20)}`, value: 89_000 }],
});

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

const chainRegistry = {
    get: () => ({ id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }),
    list: () => [],
    chainIdFor: (coin, network) => (coin === 'litecoin' && network === 'regtest' ? CHAIN : null),
};

/** A fresh host, as a reload builds one, over the vault records `pendingTxs` holds. */
function bootHost({ pendingTxs, broadcastTx, entries = [] }) {
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
            load: async () => ({ [W]: entries }),
            save: async () => {},
            clear: async () => {},
        },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = async (type, request) => host.handle({ type, request });
    const list = async () => (await call('broadcast.queue.list', { walletId: W })).result;
    const sent = () => sdk.encoder.broadcastTx.mock.calls.map(([hex]) => hex);
    return { host, vault, call, list, sent };
}

const revealLegs = (commitTxid, encoding) => {
    const scriptType = encoding === 'P2WSH' ? 'p2wsh' : 'p2sh';
    const script = { [scriptType === 'p2wsh' ? 'witnessScriptHex' : 'redeemScriptHex']: '0100' };
    return { inputs: [{ prevTxHash: commitTxid, prevTxIndex: 0, scriptType, ...script }], outputs: [{ scriptType }] };
};

/** Run a two-phase submit against `pendingTxs`, its encoder broadcasting through `broadcastTx`. */
function submitTwoPhase({ encoding, pendingTxs, broadcastTx, onBroadcastFailure }) {
    const encoder = {
        createTx: vi.fn(async () => ({ psbt: 'PHASE1', encoding })),
        spendP2sh: vi.fn(async () => ({ psbt: 'PHASE2' })),
        broadcastTx: vi.fn(broadcastTx),
    };
    const sdk = {
        encoder,
        actions: { createAction: () => ({ actionString: 'DEPLOY|0|x|1', action: 'DEPLOY', version: 0 }) },
        wallet: { decomposePsbt: () => revealLegs('txid-PHASE1', encoding) },
    };
    const run = submitAction({
        vault: { pendingTxs, settings: { get: async () => ({}), put: async () => {} } },
        walletId: W,
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        chainId: CHAIN,
        actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '1' } },
        encoderOpts: { pubkey: 'pub' },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        signer: {
            kind: 'software',
            signPsbt: async ({ psbtHex }) => ({
                signedPsbtHex: `SIGNED(${psbtHex})`,
                txHex: psbtHex === 'PHASE2' ? REVEAL.txHex : COMMIT.txHex,
                txid: `txid-${psbtHex}`,
            }),
        },
        pendingTxMeta: { fromAddress: ADDR, toAddress: null, actionSummary: 'Deploy' },
        onBroadcastFailure,
    });
    return { encoder, run };
}

const never = () => new Promise(() => {});

describe.each(['P2SH', 'P2WSH'])('the host queue resumes a %s submit interrupted after its commit', (encoding) => {
    it('rebuilds commit and reveal as one entry and sends both in order', async () => {
        const pendingTxs = memCollection();
        // The worker dies while the reveal's broadcast is in flight.
        const s = submitTwoPhase({
            encoding, pendingTxs, broadcastTx: async (hex) => (hex === REVEAL.txHex ? never() : {}),
        });
        void s.run.catch(() => {});
        await vi.waitFor(() => expect(s.encoder.broadcastTx).toHaveBeenCalledWith(REVEAL.txHex));
        const [row] = await pendingTxs.list();
        expect(row).toMatchObject({ status: 'broadcasting', txHex: COMMIT.txHex, revealTxHex: REVEAL.txHex });

        // A wait of a millisecond or more keeps the record older than the next boot.
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        const h = bootHost({
            pendingTxs,
            broadcastTx: async (hex) => {
                if (hex === COMMIT.txHex) throw new Error('txn-already-in-mempool');
                return { txid: 'txid-PHASE2' };
            },
        });
        const listed = await h.list();
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
            pendingTxId: row.id, signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1',
            revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2', resumedClaim: true,
        });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: listed[0].id });

        expect(res.ok).toBe(true);
        expect(h.sent()).toEqual([COMMIT.txHex, REVEAL.txHex]);
        expect(await pendingTxs.get(row.id)).toMatchObject({
            status: 'broadcast', txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
        });
        expect(await h.list()).toEqual([]);
    });
});

describe('the host queue sends a two-phase entry as commit then reveal', () => {
    const pair = {
        id: 'A', chainId: CHAIN, signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1', summary: 'Deploy',
        signedAt: 1, pendingTxId: 'p1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
    };
    const record = (extra = {}) => ({
        id: 'p1', chain: 'litecoin', network: 'regtest', fromAddress: ADDR, status: 'queued',
        txHex: COMMIT.txHex, txid: 'txid-PHASE1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
        createdAt: '2026-01-01T00:00:00.000Z', ...extra,
    });

    it('keeps the pair queued when the commit is refused, and sends no reveal', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(record());
        const h = bootHost({ pendingTxs, entries: [pair], broadcastTx: async () => { throw new Error('ECONNREFUSED'); } });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(false);
        expect(h.sent()).toEqual([COMMIT.txHex]);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'queued', txHex: COMMIT.txHex, revealTxHex: REVEAL.txHex });
        expect((await h.list())[0]).toMatchObject({ signedTxHex: COMMIT.txHex, revealTxHex: REVEAL.txHex });
    });

    it('turns the entry into its reveal, commit-landed, when only the reveal is refused', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(record());
        let revealUp = false;
        const h = bootHost({
            pendingTxs,
            entries: [pair],
            broadcastTx: async (hex) => {
                if (hex === REVEAL.txHex && !revealUp) throw new Error('ETIMEDOUT');
                return { txid: hex === REVEAL.txHex ? 'txid-PHASE2' : 'txid-PHASE1' };
            },
        });

        const first = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        expect(first.ok).toBe(false);
        expect(h.sent()).toEqual([COMMIT.txHex, REVEAL.txHex]);
        const [entry] = await h.list();
        expect(entry).toMatchObject({
            id: 'A', signedTxHex: REVEAL.txHex, txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
        });
        expect(entry.revealTxHex).toBeUndefined();
        expect(await pendingTxs.get('p1')).toMatchObject({
            status: 'queued', txHex: REVEAL.txHex, txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
        });

        // The retry, past its backoff, sends the reveal alone.
        revealUp = true;
        const later = Date.now() + 120_000;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
        try {
            const second = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
            expect(second.ok).toBe(true);
        } finally {
            clock.mockRestore();
        }
        expect(h.sent()).toEqual([COMMIT.txHex, REVEAL.txHex, REVEAL.txHex]);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2' });
        expect(await h.list()).toEqual([]);
    });

    // Two windows press Send now on one entry: the second is refused by name, so
    // its banner can say the send is underway instead of asking for a retry.
    it('refuses a second send of an entry another window is sending, by a named error', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(record());
        const h = bootHost({ pendingTxs, entries: [pair], broadcastTx: never });

        void h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        await vi.waitFor(() => expect(h.sent()).toEqual([COMMIT.txHex]));
        const second = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(second.ok).toBe(false);
        expect(second.error).toMatchObject({ name: 'QueuedBroadcastInFlightError' });
        expect(h.sent()).toEqual([COMMIT.txHex]);
    });

    it('sends an entry written before the reveal field as the one transaction it names', async () => {
        const pendingTxs = memCollection();
        const old = record();
        delete old.revealTxHex;
        delete old.revealTxid;
        await pendingTxs.put(old);
        const { revealTxHex: _h, revealTxid: _t, ...oldEntry } = pair;
        const h = bootHost({ pendingTxs, entries: [oldEntry], broadcastTx: async () => ({ txid: 'txid-PHASE1' }) });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(true);
        expect(h.sent()).toEqual([COMMIT.txHex]);
        const after = await pendingTxs.get('p1');
        expect(after).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE1' });
        expect(after.commitLanded).toBeUndefined();
    });
});

describe.each(['P2SH', 'P2WSH'])('a %s commit refused by a temporary broadcast failure on the host', (encoding) => {
    it('queues one entry for commit and reveal, and Broadcast now sends both in order', async () => {
        const pendingTxs = memCollection();
        const engine = createBroadcastQueueEngine({
            store: createBroadcastQueueStore({ storage: null }),
            importedAddressIdsFor: async () => new Set(),
            discardQueuedBroadcast: async () => {},
        });
        const s = submitTwoPhase({
            encoding,
            pendingTxs,
            broadcastTx: async () => { throw new Error('ECONNREFUSED'); },
            onBroadcastFailure: engine.enqueueOnBroadcastFailure(W),
        });
        await expect(s.run).rejects.toMatchObject({ name: 'BroadcastFailedTransientError' });

        const queued = engine.getQueue(W);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({
            signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
        });

        // The persisted entry, as the next host to serve the queue reads it.
        const h = bootHost({ pendingTxs, entries: JSON.parse(JSON.stringify(queued)), broadcastTx: async () => ({}) });
        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: queued[0].id });

        expect(res.ok).toBe(true);
        expect(h.sent()).toEqual([COMMIT.txHex, REVEAL.txHex]);
        expect(await pendingTxs.get(queued[0].pendingTxId)).toMatchObject({
            status: 'broadcast', txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
        });
        expect(await h.list()).toEqual([]);
    });
});
