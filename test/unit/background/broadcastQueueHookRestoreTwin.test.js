// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The auto-enqueue hook against a vault rebuild that ran first. The signing
// flow stamps its PendingTx 'queued' before it calls the hook, so a first
// queue list in that gap rebuilds the record with no ADS verdict. The hook
// must then fold its verdict into that rebuilt entry, not queue the same
// signed bytes a second time.

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const CHAIN = 'bitcoin-regtest';
const ADDR = 'bcrt1qwallet-a';
const VERDICT = { chainId: CHAIN, donationIncluded: true };

function memStorage() {
    let blob = {};
    return {
        async load() { return JSON.parse(JSON.stringify(blob)); },
        async loadSettlements() { return []; },
        async save(snapshot) { blob = JSON.parse(JSON.stringify(snapshot)); },
        async saveSettlements() {},
        async clear() { blob = {}; },
        read: () => JSON.parse(JSON.stringify(blob)),
    };
}

// One wallet owning one address, holding one PendingTx the signing flow stamped 'queued'.
function vaultWithQueuedRecord() {
    const record = {
        id: 'p1', chain: 'bitcoin', network: 'regtest', fromAddress: ADDR,
        actionSummary: 'Send', status: 'queued', txHex: 'hex-p1', txid: 'tx-p1',
        createdAt: '2026-01-01T00:00:00.000Z',
    };
    return {
        pendingTxs: { findBy: async (k, v) => (record[k] === v ? [{ ...record }] : []) },
        accounts: { findBy: async () => [{ id: 'acct-1', walletId: W }] },
        addresses: { list: async () => [{ id: 'addr-1', accountId: 'acct-1', address: ADDR }] },
    };
}

const chainRegistry = { chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN : null) };

async function boot() {
    const storage = memStorage();
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
    await engine.ensureQueueLoaded();
    return { storage, engine };
}

const hookEntry = (extra = {}) => ({
    chainId: CHAIN, signedTxHex: 'hex-p1', txid: 'tx-p1', summary: 'Send', signedAt: 1,
    pendingTxId: 'p1', adsCommit: VERDICT, ...extra,
});

describe('the auto-enqueue hook after a vault rebuild of the same PendingTx', () => {
    it('keeps one entry and moves the hook verdict onto the rebuilt one', async () => {
        const { storage, engine } = await boot();
        await engine.restoreQueueFromVault(vaultWithQueuedRecord(), chainRegistry, W);
        expect(engine.getQueue(W)).toHaveLength(1);
        expect(engine.getQueue(W)[0].adsCommit).toBeUndefined();

        await engine.enqueueOnBroadcastFailure(W)(hookEntry());

        const q = engine.getQueue(W);
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ pendingTxId: 'p1', signedTxHex: 'hex-p1', adsCommit: VERDICT });
        expect(storage.read()[W]).toEqual([expect.objectContaining({ pendingTxId: 'p1', adsCommit: VERDICT })]);
    });

    it('still queues bytes that differ from the rebuilt entry, so no signed transaction is dropped', async () => {
        const { engine } = await boot();
        await engine.restoreQueueFromVault(vaultWithQueuedRecord(), chainRegistry, W);

        await engine.enqueueOnBroadcastFailure(W)(hookEntry({ signedTxHex: 'hex-other' }));

        expect(engine.getQueue(W).map((e) => e.signedTxHex)).toEqual(['hex-p1', 'hex-other']);
    });

    it('still queues an entry that names no PendingTx', async () => {
        const { engine } = await boot();
        await engine.restoreQueueFromVault(vaultWithQueuedRecord(), chainRegistry, W);

        await engine.enqueueOnBroadcastFailure(W)(hookEntry({ pendingTxId: null }));

        expect(engine.getQueue(W)).toHaveLength(2);
    });

    it('a rebuild after the hook already queued the record adds nothing', async () => {
        const { engine } = await boot();
        await engine.enqueueOnBroadcastFailure(W)(hookEntry());
        await engine.restoreQueueFromVault(vaultWithQueuedRecord(), chainRegistry, W);

        expect(engine.getQueue(W)).toHaveLength(1);
        expect(engine.getQueue(W)[0].adsCommit).toEqual(VERDICT);
    });
});
