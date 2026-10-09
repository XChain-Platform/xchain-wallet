// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, it, expect } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

function memoryStorage({ refuseSave = false } = {}) {
    let blob = {};
    return {
        async load() { return structuredClone(blob); },
        async loadSettlements() { return []; },
        async save(next) {
            if (refuseSave) throw new Error('storage refused');
            blob = structuredClone(next);
        },
        async saveSettlements() {},
        async clear() { blob = {}; },
        read: () => structuredClone(blob),
    };
}

function boot(storage) {
    const store = createBroadcastQueueStore({ storage, prunedLedger: null });
    return createBroadcastQueueEngine({
        store,
        importedAddressIdsFor: async () => new Set(),
        discardQueuedBroadcast: async () => {},
    });
}

const entry = {
    chainId: 'bitcoin-regtest',
    signedTxHex: 'signed-transaction',
    txid: 'txid-1',
    signedAt: 1,
    summary: 'Send',
    pendingTxId: null,
    adsCommit: null,
};

describe('enqueueOnBroadcastFailure persistence verdict', () => {
    it('returns true only after the queue blob lands', async () => {
        const storage = memoryStorage();
        const engine = boot(storage);

        const saved = await engine.enqueueOnBroadcastFailure('wallet-1')(entry);

        expect(saved).toBe(true);
        expect(storage.read()['wallet-1']).toEqual([
            expect.objectContaining({ signedTxHex: 'signed-transaction' }),
        ]);
    });

    it('returns false when storage refuses the queue write', async () => {
        const storage = memoryStorage({ refuseSave: true });
        const engine = boot(storage);

        const saved = await engine.enqueueOnBroadcastFailure('wallet-1')(entry);

        expect(saved).toBe(false);
        expect(engine.getQueue('wallet-1')).toHaveLength(1);
        const restarted = boot(storage);
        await restarted.ensureQueueLoaded();
        expect(restarted.getQueue('wallet-1')).toEqual([]);
    });
});
