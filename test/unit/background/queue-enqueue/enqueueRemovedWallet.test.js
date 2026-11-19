// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The renderer's explicit enqueue route goes through the same removed-wallet
// gate as every other enqueue path. A wallet removed in this process, whether
// before the call or while its signature verification was in flight, never gets
// signed bytes written to the queue blob under its id.

import { describe, it, expect, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import { signedTxFor, trackerFor } from '../../../helpers/signedTx.js';

const CHAIN = 'bitcoin-regtest';
const KEPT = 'w1';
const GONE = 'w-gone';
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });

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

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

async function removableVault() {
    const wallets = memCollection();
    await wallets.put({ id: KEPT, importedKeys: [] });
    await wallets.put({ id: GONE, importedKeys: [] });
    const names = [
        'accounts', 'addresses', 'pendingTxs', 'pendingAirdrops', 'pendingDeploys',
        'multisigSigningSessions', 'coSignerAccounts', 'watchlistEntries', 'priceAlerts',
        'gatedKeys', 'autopayOrders', 'signers', 'connectedSites',
    ];
    return {
        wallets,
        ...Object.fromEntries(names.map((name) => [name, memCollection()])),
        settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
    };
}

/** Host over a vault that can remove wallets; `verifyGate` parks the signature check. */
async function makeHost({ verifyGate } = {}) {
    const saves = [];
    const tracker = trackerFor(SIGNED.prevouts, networks.regtest);
    const sdk = {
        encoder: {
            broadcastTx: vi.fn(),
            getUTXOs: async (...args) => {
                if (verifyGate) await verifyGate;
                return tracker.getUTXOs(...args);
            },
        },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const host = createBackgroundHost({
        vault: await removableVault(),
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
        },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: {
            load: async () => ({}),
            save: async (snapshot) => { saves.push(JSON.parse(JSON.stringify(snapshot))); },
            clear: async () => {},
        },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const call = (type, request) => host.handle({ type, request });
    const enqueue = (walletId) => call('broadcast.queue.enqueue', {
        walletId, chainId: CHAIN, signedTxHex: SIGNED.txHex, summary: 'R',
    });
    return { call, enqueue, saves };
}

const idsInBlob = (saves) => saves.flatMap((snapshot) => Object.keys(snapshot));

describe('a renderer enqueue for a removed wallet', () => {
    it('refuses and writes nothing under the removed id', async () => {
        const h = await makeHost();
        await h.call('wallet.remove', { walletId: GONE });
        await settle();

        const res = await h.enqueue(GONE);

        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/wallet was removed/);
        expect(idsInBlob(h.saves)).not.toContain(GONE);
        expect((await h.call('broadcast.queue.list', { walletId: GONE })).result).toEqual([]);
    });

    it('still queues for a wallet that was not removed', async () => {
        const h = await makeHost();
        await h.call('wallet.remove', { walletId: GONE });

        const res = await h.enqueue(KEPT);

        expect(res.ok).toBe(true);
        expect(res.result.persisted).toBe(true);
        expect(h.saves.at(-1)[KEPT].map((e) => e.signedTxHex)).toEqual([SIGNED.txHex]);
    });

    it('refuses when the removal lands while the signatures are being verified', async () => {
        let release;
        const verifyGate = new Promise((resolve) => { release = resolve; });
        const h = await makeHost({ verifyGate });

        const pending = h.enqueue(GONE);
        await settle();
        await h.call('wallet.remove', { walletId: GONE });
        release();
        const res = await pending;

        expect(res.ok).toBe(false);
        expect(idsInBlob(h.saves)).not.toContain(GONE);
    });
});
