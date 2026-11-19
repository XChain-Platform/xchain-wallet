// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A host a lock tore down keeps a broadcast on the network. When that send
// fails after a later host removed the wallet, the first host's failure hook
// must refuse the entry: the removal gate lives on the store the hosts share.

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import {
    createBroadcastQueueStore,
    sealBroadcastQueueStore,
} from '../../../packages/extension/src/background/broadcastQueueStore.js';

function memoryStorage() {
    let blob = {};
    return {
        async load() { return structuredClone(blob); },
        async loadSettlements() { return []; },
        async save(next) { blob = structuredClone(next); },
        async saveSettlements() {},
        async clear() { blob = {}; },
        read: () => structuredClone(blob),
    };
}

function hostOver(store) {
    return createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
}

const entry = (txid) => ({
    chainId: 'bitcoin-regtest',
    signedTxHex: `signed-${txid}`,
    txid,
    signedAt: 1,
    summary: 'Send',
    pendingTxId: null,
    adsCommit: null,
});

describe('removed-wallet gate across hosts sharing one queue store', () => {
    it('refuses a late failure hook from a host built before the removal', async () => {
        const storage = memoryStorage();
        const store = createBroadcastQueueStore({ storage, prunedLedger: null });
        const hostA = hostOver(store);
        const lateHook = hostA.enqueueOnBroadcastFailure('w-gone');
        const hostB = hostOver(store);

        await hostB.pruneWalletFromQueue('w-gone');
        const saved = await lateHook(entry('late-1'));

        expect(saved).toBe(false);
        expect(store.queues.get('w-gone')).toBeUndefined();
        expect(storage.read()['w-gone']).toBeUndefined();
    });

    it('still queues a wallet that was not removed through the same late hook', async () => {
        const storage = memoryStorage();
        const store = createBroadcastQueueStore({ storage, prunedLedger: null });
        const hostA = hostOver(store);
        const hostB = hostOver(store);

        await hostB.pruneWalletFromQueue('w-gone');
        const saved = await hostA.enqueueOnBroadcastFailure('w-kept')(entry('kept-1'));

        expect(saved).toBe(true);
        expect(storage.read()['w-kept']).toEqual([expect.objectContaining({ txid: 'kept-1' })]);
    });

    it('empties the removal gate when the store is sealed', async () => {
        const store = createBroadcastQueueStore({ storage: memoryStorage(), prunedLedger: null });
        await hostOver(store).pruneWalletFromQueue('w-gone');
        expect(store.removedWallets.has('w-gone')).toBe(true);

        await sealBroadcastQueueStore(store);

        expect(store.removedWallets.size).toBe(0);
    });

    it('gates a hand-built store that lacks the field', async () => {
        const store = createBroadcastQueueStore({ storage: memoryStorage(), prunedLedger: null });
        delete store.removedWallets;
        const host = hostOver(store);

        await host.pruneWalletFromQueue('w-gone');

        expect((await host.enqueueSignedBroadcast('w-gone', entry('x'))).entry).toBeNull();
    });
});
