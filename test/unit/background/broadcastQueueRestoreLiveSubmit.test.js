// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The vault restore against a submit still running in this process. submitAction
// holds its PendingTx at 'broadcasting' across phase 1, the reveal and the P2SH
// phase 2 with no queue entry naming it, so a first queue list inside that window
// must not rebuild the record as an interrupted claim carrying the phase-1 bytes.

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const CHAIN = 'bitcoin-regtest';
const ADDR = 'bcrt1qwallet-a';
const BEFORE_BOOT = '2026-01-01T00:00:00.000Z';

const chainRegistry = { chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN : null) };

// One wallet owning one address, holding one PendingTx with the given fields.
function vaultWith(fields) {
    const record = {
        id: 'p1', chain: 'bitcoin', network: 'regtest', fromAddress: ADDR,
        actionSummary: 'Send', txHex: 'hex-phase1', txid: 'tx-phase1', ...fields,
    };
    return {
        pendingTxs: { findBy: async (k, v) => (record[k] === v ? [{ ...record }] : []) },
        accounts: { findBy: async () => [{ id: 'acct-1', walletId: W }] },
        addresses: { list: async () => [{ id: 'addr-1', accountId: 'acct-1', address: ADDR }] },
    };
}

async function boot() {
    const store = createBroadcastQueueStore({ storage: null, prunedLedger: null });
    const engine = createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
    await engine.ensureQueueLoaded();
    const afterBoot = new Date(store.bootedAt + 1000).toISOString();
    return { store, engine, afterBoot };
}

describe('the vault restore during a live submit in this process', () => {
    it('stamps the store with the time it was built', async () => {
        const before = Date.now();
        const { store } = await boot();
        expect(store.bootedAt).toBeGreaterThanOrEqual(before);
        expect(store.bootedAt).toBeLessThanOrEqual(Date.now());
    });

    it('leaves a broadcasting record created after boot to the call that owns it', async () => {
        const { engine, afterBoot } = await boot();
        await engine.restoreQueueFromVault(vaultWith({ status: 'broadcasting', createdAt: afterBoot }), chainRegistry, W);

        expect(engine.getQueue(W)).toEqual([]);
    });

    it('queues one phase-2 entry when the live submit then fails transiently', async () => {
        const { engine, afterBoot } = await boot();
        await engine.restoreQueueFromVault(vaultWith({ status: 'broadcasting', createdAt: afterBoot }), chainRegistry, W);

        await engine.enqueueOnBroadcastFailure(W)({
            chainId: CHAIN, signedTxHex: 'hex-phase2', txid: 'tx-phase2', summary: 'Send',
            signedAt: 1, pendingTxId: 'p1', commitLanded: true, commitTxid: 'tx-phase1', adsCommit: null,
        });

        const q = engine.getQueue(W);
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ pendingTxId: 'p1', signedTxHex: 'hex-phase2' });
        expect(q[0].resumedClaim).toBeUndefined();
    });
});

describe('the vault restore of records a live submit cannot own', () => {
    it('still rebuilds a broadcasting record a dead process left before boot', async () => {
        const { engine } = await boot();
        await engine.restoreQueueFromVault(vaultWith({ status: 'broadcasting', createdAt: BEFORE_BOOT }), chainRegistry, W);

        expect(engine.getQueue(W)).toEqual([
            expect.objectContaining({ pendingTxId: 'p1', signedTxHex: 'hex-phase1', resumedClaim: true }),
        ]);
    });

    it('still rebuilds a broadcasting record whose createdAt does not parse', async () => {
        const { engine } = await boot();
        await engine.restoreQueueFromVault(vaultWith({ status: 'broadcasting', createdAt: 'not-a-time' }), chainRegistry, W);

        expect(engine.getQueue(W)).toEqual([expect.objectContaining({ pendingTxId: 'p1', resumedClaim: true })]);
    });

    it('still rebuilds a queued record created after boot', async () => {
        const { engine, afterBoot } = await boot();
        await engine.restoreQueueFromVault(vaultWith({ status: 'queued', createdAt: afterBoot }), chainRegistry, W);

        const q = engine.getQueue(W);
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ pendingTxId: 'p1', signedTxHex: 'hex-phase1' });
        expect(q[0].resumedClaim).toBeUndefined();
    });
});
