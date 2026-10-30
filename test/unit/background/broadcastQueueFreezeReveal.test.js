// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A panic freeze that arrives while a two-phase send writes its claim stops the
// send on both lanes: the core drain and the host queue route. The record stays
// queued with its reveal, and once the freeze lifts the pair goes out once,
// commit then reveal, on its own chain.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import {
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    clearPanicModeState,
    deactivatePanicMode,
    PanicModeActiveError,
} from '../../../packages/core/src/flows/panicMode.js';
import { drainQueuedBroadcast } from '../../../packages/core/src/flows/queuedBroadcast.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
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
        _map: m,
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

/** Arms the freeze on the first write that claims a record as 'broadcasting'. */
function armingOnClaim(base) {
    let armed = false;
    return {
        ...base,
        put: async (rec) => {
            if (!armed && rec.status === 'broadcasting') {
                armed = true;
                activatePanicMode();
            }
            return base.put(rec);
        },
    };
}

const chainRegistry = {
    get: () => ({ id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }),
    list: () => [],
    chainIdFor: (coin, network) => (coin === 'litecoin' && network === 'regtest' ? CHAIN : null),
};

const record = (extra = {}) => ({
    id: 'p1', chain: 'litecoin', network: 'regtest', fromAddress: ADDR, status: 'queued',
    txHex: COMMIT.txHex, txid: 'txid-PHASE1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
    createdAt: '2026-01-01T00:00:00.000Z', error: null, ...extra,
});

const pair = {
    id: 'A', chainId: CHAIN, signedTxHex: COMMIT.txHex, txid: 'txid-PHASE1', summary: 'Deploy',
    signedAt: 1, pendingTxId: 'p1', revealTxHex: REVEAL.txHex, revealTxid: 'txid-PHASE2',
};

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
    const sent = () => sdk.encoder.broadcastTx.mock.calls.map(([hex]) => hex);
    return { call, sent };
}

beforeEach(() => {
    localStorage.clear();
    __resetPanicModePersistenceForTests();
});

afterEach(() => {
    clearPanicModeState();
    __resetPanicModePersistenceForTests();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('core drain under a freeze armed during the two-phase claim', () => {
    const sdkFor = (broadcastTx) => {
        const sdk = { encoder: { broadcastTx: vi.fn(broadcastTx) } };
        return { sdk, sdkRegistry: { get: () => sdk } };
    };

    it('sends neither half, keeps the pair queued, then sends commit and reveal once after the lift', async () => {
        const base = memCollection();
        await base.put(record());
        const pendingTxs = armingOnClaim(base);
        const { sdk, sdkRegistry } = sdkFor(async () => ({}));
        const drain = () => drainQueuedBroadcast({ vault: { pendingTxs }, sdkRegistry, chainRegistry, pendingTxId: 'p1' });

        await expect(drain()).rejects.toBeInstanceOf(PanicModeActiveError);
        expect(sdk.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(base._map.get('p1')).toMatchObject({ status: 'queued', txHex: COMMIT.txHex, revealTxHex: REVEAL.txHex });

        await expect(deactivatePanicMode()).resolves.toBe(true);
        const res = await drain();
        expect(res.broadcast).toBe(true);
        expect(sdk.encoder.broadcastTx.mock.calls.map(([h]) => h)).toEqual([COMMIT.txHex, REVEAL.txHex]);
        expect(base._map.get('p1')).toMatchObject({ status: 'broadcast', commitLanded: true, txid: 'txid-PHASE2', commitTxid: 'txid-PHASE1' });
    });

    it('resumes a commit-landed record under a freeze with nothing sent, then sends the reveal alone once', async () => {
        const base = memCollection();
        await base.put(record({
            status: 'broadcasting', txHex: REVEAL.txHex, txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
        }));
        const pendingTxs = armingOnClaim(base);
        const { sdk, sdkRegistry } = sdkFor(async () => ({}));
        const drain = () => drainQueuedBroadcast({ vault: { pendingTxs }, sdkRegistry, chainRegistry, pendingTxId: 'p1' });

        await expect(drain()).rejects.toBeInstanceOf(PanicModeActiveError);
        expect(sdk.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(base._map.get('p1')).toMatchObject({ txHex: REVEAL.txHex, commitLanded: true });

        await expect(deactivatePanicMode()).resolves.toBe(true);
        await drain();
        expect(sdk.encoder.broadcastTx.mock.calls.map(([h]) => h)).toEqual([REVEAL.txHex]);
        expect(base._map.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2' });
    });

    it('sends each reveal through its own chain and leaves the other wallet record untouched', async () => {
        const base = memCollection();
        await base.put(record());
        await base.put(record({ id: 'p2', chain: 'bitcoin', network: 'regtest', fromAddress: 'bcrt1qother' }));
        const pendingTxs = armingOnClaim(base);
        const sdks = {
            [CHAIN]: { encoder: { broadcastTx: vi.fn(async () => ({})) } },
            'bitcoin-regtest': { encoder: { broadcastTx: vi.fn(async () => ({})) } },
        };
        const registry = {
            get: (id) => (id === CHAIN
                ? { id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }
                : { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' }),
            chainIdFor: (coin, network) => (network === 'regtest' ? `${coin}-regtest` : null),
        };
        const drain = (id) => drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry: { get: (id2) => sdks[id2] }, chainRegistry: registry, pendingTxId: id,
        });

        await expect(drain('p1')).rejects.toBeInstanceOf(PanicModeActiveError);
        await expect(drain('p2')).rejects.toBeInstanceOf(PanicModeActiveError);
        await expect(deactivatePanicMode()).resolves.toBe(true);
        await drain('p2');
        expect(sdks['bitcoin-regtest'].encoder.broadcastTx).toHaveBeenCalledTimes(2);
        expect(sdks[CHAIN].encoder.broadcastTx).not.toHaveBeenCalled();
        expect(base._map.get('p1').status).toBe('queued');
        await drain('p1');
        expect(sdks[CHAIN].encoder.broadcastTx.mock.calls.map(([h]) => h)).toEqual([COMMIT.txHex, REVEAL.txHex]);
    });

    it('resumes after a worker restart between the commit and the reveal with the reveal alone', async () => {
        const base = memCollection();
        await base.put(record());
        const never = () => new Promise(() => {});
        const first = sdkFor(async (hex) => (hex === REVEAL.txHex ? never() : {}));
        void drainQueuedBroadcast({ vault: { pendingTxs: base }, sdkRegistry: first.sdkRegistry, chainRegistry, pendingTxId: 'p1' });
        await vi.waitFor(() => expect(first.sdk.encoder.broadcastTx).toHaveBeenCalledWith(REVEAL.txHex));
        expect(base._map.get('p1')).toMatchObject({ status: 'broadcasting', commitLanded: true, txHex: REVEAL.txHex });

        // A restarted worker loads the module afresh, without the old drain's claim.
        vi.resetModules();
        const fresh = await import('../../../packages/core/src/flows/queuedBroadcast.js');
        const second = sdkFor(async () => ({}));
        await fresh.drainQueuedBroadcast({ vault: { pendingTxs: base }, sdkRegistry: second.sdkRegistry, chainRegistry, pendingTxId: 'p1' });
        expect(second.sdk.encoder.broadcastTx.mock.calls.map(([h]) => h)).toEqual([REVEAL.txHex]);
        expect(base._map.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2' });
    });
});

describe('host queue route under a freeze armed during the two-phase claim', () => {
    it('sends neither half when the freeze lands while the claim is written', async () => {
        const base = memCollection();
        await base.put(record());
        const h = bootHost({ pendingTxs: armingOnClaim(base), entries: [pair], broadcastTx: async () => ({}) });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(false);
        expect(h.sent()).toEqual([]);
        expect(base._map.get('p1')).toMatchObject({ status: 'queued', txHex: COMMIT.txHex, revealTxHex: REVEAL.txHex });
    });

    it('sends commit and reveal once after the freeze lifts', async () => {
        const base = memCollection();
        await base.put(record());
        const h = bootHost({ pendingTxs: armingOnClaim(base), entries: [pair], broadcastTx: async () => ({}) });

        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });
        await expect(deactivatePanicMode()).resolves.toBe(true);
        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(h.sent().filter((x) => x === COMMIT.txHex)).toHaveLength(1);
        expect(h.sent().filter((x) => x === REVEAL.txHex)).toHaveLength(1);
        expect(base._map.get('p1').status).toBe('broadcast');
    });

    it('holds the reveal when the freeze lands after the commit, then sends the reveal alone once', async () => {
        const base = memCollection();
        await base.put(record());
        const h = bootHost({
            pendingTxs: base,
            entries: [pair],
            broadcastTx: async (hex) => {
                if (hex === COMMIT.txHex) activatePanicMode();
                return {};
            },
        });

        const res = await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(res.ok).toBe(false);
        expect(h.sent()).toEqual([COMMIT.txHex]);
        expect(base._map.get('p1')).toMatchObject({ commitLanded: true, txHex: REVEAL.txHex, commitTxid: 'txid-PHASE1' });

        await expect(deactivatePanicMode()).resolves.toBe(true);
        await h.call('broadcast.queue.broadcast', { walletId: W, id: 'A' });

        expect(h.sent()).toEqual([COMMIT.txHex, REVEAL.txHex]);
        expect(base._map.get('p1').status).toBe('broadcast');
    });
});
