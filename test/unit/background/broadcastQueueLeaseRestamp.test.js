// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One web page keeps one queue store across lease handoffs. A 'broadcasting'
// PendingTx another tab wrote while this page was dormant, and then died on,
// is not a live call of this page, so the restore after the next lease must
// offer it instead of treating it as in flight here.

import { describe, it, expect } from 'vitest';
import { __createWebVaultMultiTabHarnessForTests } from '../../../packages/web/src/hostBridge.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import {
    createBroadcastQueueStore,
    refreshBroadcastQueueStore,
} from '../../../packages/extension/src/background/broadcastQueueStore.js';

const W = 'w1';
const CHAIN = 'bitcoin-regtest';
const ADDR = 'bcrt1qwallet-a';
const chainRegistry = { chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN : null) };

function vaultWith(record) {
    const full = {
        id: 'p1', chain: 'bitcoin', network: 'regtest', fromAddress: ADDR,
        actionSummary: 'Send', txHex: 'hex-phase1', txid: 'tx-phase1', status: 'broadcasting', ...record,
    };
    return {
        pendingTxs: { findBy: async (k, v) => (full[k] === v ? [{ ...full }] : []) },
        accounts: { findBy: async () => [{ id: 'acct-1', walletId: W }] },
        addresses: { list: async () => [{ id: 'addr-1', accountId: 'acct-1', address: ADDR }] },
    };
}

const memoryStorage = () => ({ load: async () => ({}), save: async () => {} });

function engineOver(store) {
    return createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
}

describe('the vault restore after a lease handoff', () => {
    it('restamps the boot stamp when the store takes a lease', async () => {
        const store = createBroadcastQueueStore({ storage: memoryStorage(), prunedLedger: null });
        store.bootedAt = Date.now() - 60_000;
        store.dormant = true;
        const before = Date.now();

        await refreshBroadcastQueueStore(store);

        expect(store.bootedAt).toBeGreaterThanOrEqual(before);
        expect(store.dormant).toBe(false);
    });

    it('restamps the boot stamp for a store with no storage too', async () => {
        const store = createBroadcastQueueStore({ storage: null, prunedLedger: null });
        store.bootedAt = Date.now() - 60_000;
        const before = Date.now();

        await refreshBroadcastQueueStore(store);

        expect(store.bootedAt).toBeGreaterThanOrEqual(before);
    });

    it('rebuilds a broadcasting record another tab wrote after this store was built', async () => {
        const store = createBroadcastQueueStore({ storage: memoryStorage(), prunedLedger: null });
        store.bootedAt = Date.now() - 60_000;
        const otherTabCreatedAt = new Date(Date.now() - 30_000).toISOString();
        await refreshBroadcastQueueStore(store);
        const engine = engineOver(store);

        await engine.restoreQueueFromVault(vaultWith({ createdAt: otherTabCreatedAt }), chainRegistry, W);

        expect(engine.getQueue(W)).toEqual([
            expect.objectContaining({ pendingTxId: 'p1', signedTxHex: 'hex-phase1', resumedClaim: true }),
        ]);
    });

    it('leaves a broadcasting record written after the lease to the call that owns it', async () => {
        const store = createBroadcastQueueStore({ storage: memoryStorage(), prunedLedger: null });
        store.bootedAt = Date.now() - 60_000;
        await refreshBroadcastQueueStore(store);
        const engine = engineOver(store);
        const ownCreatedAt = new Date(store.bootedAt + 1000).toISOString();

        await engine.restoreQueueFromVault(vaultWith({ createdAt: ownCreatedAt }), chainRegistry, W);

        expect(engine.getQueue(W)).toEqual([]);
    });
});

describe('the vault restore across a real lease handoff', () => {
    const past = (ms) => new Date(Date.now() - ms).toISOString();

    it('offers the record a closed tab left once this tab takes the lease', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const tabB = harness.createTab();
        await tabB.acquire();
        const bootB = tabB.bootedAt();
        await tabB.release();
        const leftByDeadTab = past(0);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await tabB.acquire();

        expect(tabB.bootedAt()).toBeGreaterThan(bootB);
        await tabB.restoreFromVault(vaultWith({ createdAt: leftByDeadTab }), chainRegistry, W);
        expect(await tabB.list(W)).toEqual([expect.objectContaining({ pendingTxId: 'p1', resumedClaim: true })]);
    });

    it('keeps the lease and the boot stamp while this page has a call in flight', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const tab = harness.createTab();
        await tab.acquire();
        const stamp = tab.bootedAt();
        const ownRecord = new Date(stamp + 1000).toISOString();
        tab.beginBroadcast('claim');

        await tab.release();
        await tab.acquire();

        expect(tab.state()).toEqual({ hasLease: true, releaseDeferred: false });
        expect(tab.bootedAt()).toBe(stamp);
        await tab.restoreFromVault(vaultWith({ createdAt: ownRecord }), chainRegistry, W);
        expect(await tab.list(W)).toEqual([]);
    });
});
