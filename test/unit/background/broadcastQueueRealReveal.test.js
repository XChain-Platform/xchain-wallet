// @vitest-environment node

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A two-phase entry whose reveal is a real data-carrier spend signed by the
// SDK's reveal signer: after a transient reveal failure the queue holds those
// bytes, and "Broadcast now", the paste route and a reload must still send
// them, because the broadcast check verifies the carrier spend. Altered bytes
// stay refused and unsent.

import { describe, it, expect, vi } from 'vitest';
import { networks, Transaction } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';
import { signedReveal } from '../../helpers/carrierReveal.js';

const CHAIN = 'litecoin-regtest';
const W = 'w1';
const ADDR = 'rltc1qsrc';
const COMMIT = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });

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

/** A fresh host over the entries and vault records given, the tracker listing `prevouts`. */
function bootHost({ pendingTxs, entries, prevouts, broadcastTx }) {
    const vault = {
        pendingTxs,
        wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
        accounts: { findBy: async (key, value) => (key === 'walletId' ? [{ id: `acct-${value}`, walletId: value }] : []) },
        addresses: { list: async () => [{ id: 'addr-a', accountId: `acct-${W}`, address: ADDR }] },
        settings: { get: vi.fn(async () => ({})), put: vi.fn(async () => {}) },
    };
    const tracker = trackerFor(prevouts, networks.regtest);
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
        broadcastQueueStorage: { load: async () => ({ [W]: entries }), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return {
        call: (type, request) => host.handle({ type, request }),
        list: async () => (await host.handle({ type: 'broadcast.queue.list', request: { walletId: W } })).result,
        sent: () => sdk.encoder.broadcastTx.mock.calls.map(([hex]) => hex),
    };
}

const record = (reveal, extra = {}) => ({
    id: 'p1', chain: 'litecoin', network: 'regtest', fromAddress: ADDR, status: 'queued',
    txHex: reveal.txHex, txid: reveal.txid, commitLanded: true, commitTxid: 'txid-PHASE1',
    createdAt: '2026-01-01T00:00:00.000Z', ...extra,
});

const revealEntry = (reveal) => ({
    id: 'R', chainId: CHAIN, signedTxHex: reveal.txHex, txid: reveal.txid, summary: 'Deploy',
    signedAt: 1, pendingTxId: 'p1', commitLanded: true, commitTxid: 'txid-PHASE1',
});

describe.each(['P2SH', 'P2WSH'])('a queued %s reveal signed by the SDK', (encoding) => {
    it('is sent by Broadcast now, as a reload would find it persisted', async () => {
        const reveal = signedReveal({ encoding });
        const pendingTxs = memCollection();
        await pendingTxs.put(record(reveal));
        const h = bootHost({
            pendingTxs, entries: [revealEntry(reveal)], prevouts: reveal.prevouts, broadcastTx: async () => ({ txid: reveal.txid }),
        });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'R' });

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(h.sent()).toEqual([reveal.txHex]);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: reveal.txid });
        expect(await h.list()).toEqual([]);
    });

    it('is sent by the paste route', async () => {
        const reveal = signedReveal({ encoding });
        const h = bootHost({
            pendingTxs: memCollection(), entries: [], prevouts: reveal.prevouts, broadcastTx: async () => ({ txid: reveal.txid }),
        });

        const res = await h.call('broadcast.signedTx', { walletId: W, chainId: CHAIN, txHex: reveal.txHex });

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(h.sent()).toEqual([reveal.txHex]);
    });

});

describe.each(['P2SH', 'P2WSH'])('a queued %s reveal that was altered, or sent by retry', (encoding) => {
    it('stays queued and unsent when its output was altered', async () => {
        const reveal = signedReveal({ encoding });
        const altered = Transaction.fromHex(reveal.txHex);
        altered.outs[0].value = 95_000;
        const bad = { txHex: altered.toHex(), txid: altered.getId() };
        const pendingTxs = memCollection();
        await pendingTxs.put(record(bad));
        const h = bootHost({ pendingTxs, entries: [revealEntry(bad)], prevouts: reveal.prevouts, broadcastTx: async () => ({}) });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'R' });

        expect(res.ok).toBe(false);
        expect(h.sent()).toEqual([]);
        expect(await h.list()).toHaveLength(1);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'queued' });
    });

    it('is sent by the retry that follows a commit landing and its reveal failing transiently', async () => {
        const reveal = signedReveal({ encoding });
        const pendingTxs = memCollection();
        await pendingTxs.put({
            ...record(COMMIT, { txHex: COMMIT.txHex, txid: 'txid-PHASE1' }),
            commitLanded: undefined, commitTxid: undefined, revealTxHex: reveal.txHex, revealTxid: reveal.txid,
        });
        let revealUp = false;
        const h = bootHost({
            pendingTxs,
            entries: [{ ...revealEntry(reveal), signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1', commitLanded: undefined, commitTxid: undefined, revealTxHex: reveal.txHex, revealTxid: reveal.txid }],
            prevouts: [...COMMIT.prevouts, ...reveal.prevouts],
            broadcastTx: async (hex) => {
                if (hex === reveal.txHex && !revealUp) throw new Error('ETIMEDOUT');
                return { txid: hex === reveal.txHex ? reveal.txid : 'txid-PHASE1' };
            },
        });

        const first = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'R' });
        expect(first.ok).toBe(false);
        expect(await h.list()).toMatchObject([{ id: 'R', signedTxHex: reveal.txHex, commitLanded: true }]);

        revealUp = true;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
        try {
            const second = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'R' });
            expect(second.ok, JSON.stringify(second.error)).toBe(true);
        } finally {
            clock.mockRestore();
        }
        expect(h.sent()).toEqual([COMMIT.txHex, reveal.txHex, reveal.txHex]);
        expect(await h.list()).toEqual([]);
    });
});
