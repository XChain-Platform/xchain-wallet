// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const walletId = 'w1';
const chainRegistry = { chainIdFor: () => 'bitcoin-regtest' };
const records = [
    { id: 'p-hd', fromAddress: 'hd', status: 'queued', txHex: '00', createdAt: '2026-01-01' },
    { id: 'p-wif', fromAddress: 'wif', status: 'queued', txHex: '01', createdAt: '2026-01-02' },
].map((record) => ({ ...record, chain: 'bitcoin', network: 'regtest' }));

function vault() {
    return {
        accounts: { findBy: async () => [{ id: 'acct-1', walletId }] },
        addresses: {
            list: async () => [
                { id: 'a-hd', accountId: 'acct-1', address: 'hd' },
                { id: 'a-wif', accountId: null, address: 'wif' },
            ],
        },
        pendingTxs: { findBy: async (field, value) => records.filter((r) => r[field] === value) },
    };
}

describe('broadcast queue imported-address inventory', () => {
    it('retries a wallet after a strict imported-key read fails', async () => {
        const importedAddressIdsFor = vi.fn()
            .mockRejectedValueOnce(new Error('wallet unavailable'))
            .mockResolvedValue(new Set(['a-wif']));
        const engine = createBroadcastQueueEngine({
            store: createBroadcastQueueStore({ storage: null, prunedLedger: null }),
            importedAddressIdsFor,
            discardQueuedBroadcast: async () => {},
        });

        await engine.restoreQueueFromVault(vault(), chainRegistry, walletId);
        expect(engine.getQueue(walletId)).toEqual([]);

        await engine.restoreQueueFromVault(vault(), chainRegistry, walletId);
        expect(engine.getQueue(walletId).map((entry) => entry.pendingTxId)).toEqual(['p-hd', 'p-wif']);
        expect(importedAddressIdsFor).toHaveBeenCalledTimes(2);
    });
});
