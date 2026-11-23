// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Discard route removes the queue entry whatever the PendingTx half does,
// so when another discard holds that PendingTx the route has to journal its
// own discard. Otherwise a holder whose delete then fails leaves the record
// 'queued' with nothing owed against it, and the next list rebuilds the row
// the user discarded.

import { describe, it, expect, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { discardQueuedBroadcast } from '@xchain-wallet/core/flows/queuedBroadcast.js';
import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import { signedTxFor, trackerFor } from '../../../helpers/signedTx.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';
const A_ADDR = 'bcrt1qwallet-a';
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

/** PendingTx records whose next delete waits on `gate.next` before it settles. */
function gatedCollection() {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const gate = { next: null, entered: deferred() };
    const records = {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        update: async (id, decide) => {
            const next = decide(m.has(id) ? copy(m.get(id)) : null);
            if (next == null) return false;
            m.set(id, copy(next));
            return true;
        },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => {
            const held = gate.next;
            gate.next = null;
            if (held) {
                gate.entered.resolve();
                await held.promise;
            }
            return m.delete(id);
        },
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
    return { records, gate };
}

function makeHost(pendingTxs) {
    const tracker = trackerFor(SIGNED.prevouts, networks.regtest);
    const sdk = {
        encoder: { broadcastTx: vi.fn(), getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const vault = {
        pendingTxs,
        wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
        accounts: { findBy: async (k, v) => (k === 'walletId' ? [{ id: `acct-${v}`, walletId: v }] : []) },
        addresses: { list: async () => [{ id: 'addr-a', accountId: `acct-${W}`, address: A_ADDR }] },
        settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
    };
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
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = async (type, request) => host.handle({ type, request });
    const list = async () => (await call('broadcast.queue.list', { walletId: W })).result;
    return { call, list, vault };
}

describe('Discard route while another discard holds the PendingTx', () => {
    it('journals its discard, so a holder whose delete fails does not bring the row back', async () => {
        const { records, gate } = gatedCollection();
        await records.put({
            id: 'p1', chain: 'bitcoin', network: 'regtest', fromAddress: A_ADDR, action: 'SEND',
            actionSummary: 'Send p1', status: 'queued', txHex: SIGNED.txHex, txid: 'tx-p1',
            error: 'ECONNREFUSED', createdAt: '2026-01-01T00:00:00.000Z',
        });
        const h = makeHost(records);
        const [row] = await h.list();
        expect(row).toBeTruthy();

        const held = deferred();
        gate.next = held;
        const holder = discardQueuedBroadcast({ vault: h.vault, pendingTxId: 'p1' });
        await gate.entered.promise;
        const res = await h.call('broadcast.queue.discard', { walletId: W, id: row.id });
        expect(res.result).toEqual({ discarded: true });

        held.reject(new Error('write failed'));
        await expect(holder).rejects.toThrow('write failed');
        expect(await records.get('p1')).toMatchObject({ status: 'queued' });

        expect(await h.list()).toEqual([]);
        expect(await records.get('p1')).toBeNull();
    });
});
