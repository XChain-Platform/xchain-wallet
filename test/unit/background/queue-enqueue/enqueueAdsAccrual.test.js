// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bytes parked through the explicit enqueue route count toward automatic
// donations when they land, as bytes sent through broadcast.signedTx do. The
// verdict is keyed by the bytes' txid, so the same transaction books once, and
// it is never put on a transaction a wallet flow or a live entry already owns.

import { describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import { rawTxid } from '../../../../packages/core/src/signers/verifySignedTx.js';
import { signedTxFor, trackerFor } from '../../../helpers/signedTx.js';

const WALLET = 'wallet-1';
const CHAIN = 'bitcoin-regtest';
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const TXID = rawTxid(SIGNED.txHex);

function memCollection({ findByThrows = false } = {}) {
    const records = new Map();
    const copy = (value) => JSON.parse(JSON.stringify(value));
    return {
        get: async (id) => (records.has(id) ? copy(records.get(id)) : null),
        put: async (record) => { records.set(record.id, copy(record)); },
        update: async (id, decide) => {
            const next = decide(records.has(id) ? copy(records.get(id)) : null);
            if (next == null) return false;
            records.set(id, copy(next));
            return true;
        },
        list: async () => Array.from(records.values()).map(copy),
        delete: async (id) => records.delete(id),
        findBy: async (key, value) => {
            if (findByThrows) throw new Error('store unreadable');
            return Array.from(records.values()).filter((record) => record[key] === value).map(copy);
        },
    };
}

function makeHost({ mainnet = true, findByThrows = false, persisted = {}, shared = null, onSettingsGet = null } = {}) {
    const pendingTxs = shared?.pendingTxs ?? memCollection({ findByThrows });
    const snapshots = shared?.snapshots ?? [];
    const state = shared?.state ?? {
        settings: {
            activeNetwork: mainnet ? 'mainnet' : 'regtest',
            fiatCurrency: 'USD',
            ads: {
                perTransaction: '0.05', sendAt: '5', recipient: 'protocol', currency: 'USD',
                queued: '0', donated: '0', donationCount: 0,
            },
        },
    };
    const tracker = trackerFor(SIGNED.prevouts, networks.regtest);
    const sdk = {
        encoder: { broadcastTx: vi.fn(async () => ({ txid: TXID })), getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const host = createBackgroundHost({
        vault: {
            pendingTxs,
            wallets: { list: async () => [{ id: WALLET, name: 'Wallet' }] },
            settings: {
                get: async () => {
                    await onSettingsGet?.(pendingTxs);
                    return structuredClone(state.settings);
                },
                put: async (next) => { state.settings = structuredClone(next); },
            },
        },
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: mainnet ? 'mainnet' : 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
        },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: {
            load: async () => structuredClone(persisted),
            save: async (snapshot) => { snapshots.push(JSON.parse(JSON.stringify(snapshot))); },
            clear: async () => {},
        },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = (type, request) => host.handle({ type, request });
    const enqueue = () => call('broadcast.queue.enqueue', {
        walletId: WALLET, chainId: CHAIN, signedTxHex: SIGNED.txHex, summary: 'Parked',
    });
    const land = (id) => call('broadcast.queue.broadcast', { walletId: WALLET, id });
    const ads = () => state.settings.ads;
    return { call, enqueue, land, ads, pendingTxs, snapshots, state };
}

describe('broadcast.queue.enqueue books a donation step when its bytes land', () => {
    it('accrues one mainnet step keyed by the txid and persists the verdict', async () => {
        const h = makeHost();
        const res = await h.enqueue();
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ txid: TXID, adsCommit: { mainnet: true, bookingKey: TXID } });
        expect(h.snapshots.at(-1)[WALLET][0].adsCommit).toMatchObject({ bookingKey: TXID });
        const landed = await h.land(res.result.id);
        expect(landed.ok, JSON.stringify(landed.error ?? {})).toBe(true);
        expect(h.ads().queued).toBe('0.05');
        expect(h.ads().bookedKeys.queuedDelivery).toEqual([TXID]);
    });

    it('accrues nothing when the active network is not mainnet', async () => {
        const h = makeHost({ mainnet: false });
        const res = await h.enqueue();
        await h.land(res.result.id);
        expect(h.ads().queued).toBe('0');
    });

    it('stores no verdict when a live PendingTx already holds the txid', async () => {
        const h = makeHost();
        await h.pendingTxs.put({ id: 'ptx-1', txid: TXID, status: 'broadcast', createdAt: '2026-01-01T00:00:00Z' });
        const res = await h.enqueue();
        expect(res.result.adsCommit).toBeUndefined();
        await h.land(res.result.id);
        expect(h.ads().queued).toBe('0');
    });

    it('stores no verdict when the PendingTx store cannot be read', async () => {
        const h = makeHost({ findByThrows: true });
        const res = await h.enqueue();
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result.adsCommit).toBeUndefined();
        await h.land(res.result.id);
        expect(h.ads().queued).toBe('0');
    });

    it('stores no verdict when a PendingTx owner appears during the settings read', async () => {
        let inserted = false;
        let armed = false;
        const h = makeHost({
            onSettingsGet: async (pendingTxs) => {
                if (!armed || inserted) return;
                inserted = true;
                await pendingTxs.put({
                    id: 'ptx-racing', txid: TXID, status: 'broadcast', createdAt: '2026-01-01T00:00:00Z',
                });
            },
        });
        await h.call('broadcast.queue.list', { walletId: WALLET });
        armed = true;
        const res = await h.enqueue();
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result.adsCommit).toBeUndefined();
        await h.land(res.result.id);
        expect(h.ads().queued).toBe('0');
    });
});

describe('broadcast.queue.enqueue books each transaction once', () => {
    it('books the same bytes once when enqueued twice', async () => {
        const h = makeHost();
        const first = await h.enqueue();
        const second = await h.enqueue();
        expect(second.result.id).toBe(first.result.id);
        await h.land(first.result.id);
        expect(h.ads().queued).toBe('0.05');
        expect(h.ads().bookedKeys.queuedDelivery).toEqual([TXID]);
    });

    it('books once when the same bytes later go through broadcast.signedTx', async () => {
        const h = makeHost();
        const res = await h.enqueue();
        await h.land(res.result.id);
        await h.call('broadcast.signedTx', {
            walletId: WALLET, chainId: CHAIN, txHex: SIGNED.txHex, fromAddress: 'bcrt1qsender',
        });
        expect(h.ads().queued).toBe('0.05');
        expect(h.ads().bookedKeys.queuedDelivery).toEqual([TXID]);
    });

    it('leaves a live entry that settles a PendingTx claim without a verdict', async () => {
        const held = {
            id: 'q-held', chainId: CHAIN, signedTxHex: SIGNED.txHex, summary: 'Held',
            signedAt: 1, txid: TXID, pendingTxId: 'ptx-held',
        };
        const h = makeHost({ persisted: { [WALLET]: [held] } });
        const res = await h.enqueue();
        expect(res.result.id).toBe('q-held');
        expect(res.result.adsCommit).toBeUndefined();
    });

    it('keeps the verdict across a restart and accrues on landing', async () => {
        const first = makeHost();
        const res = await first.enqueue();
        const persisted = first.snapshots.at(-1);
        const h = makeHost({ persisted, shared: { pendingTxs: first.pendingTxs, snapshots: [], state: first.state } });
        const landed = await h.land(res.result.id);
        expect(landed.ok, JSON.stringify(landed.error ?? {})).toBe(true);
        expect(h.ads().queued).toBe('0.05');
    });
});
