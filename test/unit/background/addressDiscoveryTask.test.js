// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createAddressDiscoveryTask } from '../../../packages/extension/src/background/addressDiscoveryTask.js';

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

async function settle(task) {
    for (let i = 0; i < 20 && task.status()?.status === 'running'; i++) {
        await Promise.resolve();
    }
}

describe('address discovery task', () => {
    it('runs in the background, reports progress, and keeps one scan at a time', async () => {
        const task = createAddressDiscoveryTask();
        const gate = deferred();
        let runs = 0;
        const first = await task.start({
            walletIds: ['w1'],
            countChains: async () => 2,
            chainName: (id) => ({ 'bitcoin-regtest': 'Bitcoin', 'litecoin-regtest': 'Litecoin' }[id]),
            run: async (_walletId, onProgress) => {
                runs += 1;
                onProgress({ phase: 'chain-complete', chainId: 'bitcoin-regtest', found: 2 });
                await gate.promise;
                onProgress({ phase: 'chain-failed', chainId: 'litecoin-regtest', found: 0, error: 'busy' });
            },
        });
        expect(first).toMatchObject({ status: 'running', chainsTotal: 2 });
        await Promise.resolve();
        expect(task.status()).toMatchObject({ status: 'running', chainsDone: 1, found: 2 });

        const second = await task.start({ walletIds: ['w1'], countChains: async () => 2, run: async () => { runs += 1; } });
        expect(second.id).toBe(first.id);

        gate.resolve();
        await settle(task);
        expect(task.status()).toMatchObject({
            status: 'done', chainsDone: 2, found: 2, failedChains: ['Litecoin'], dismissed: false,
        });
        expect(runs).toBe(1);

        expect(task.dismiss(first.id).dismissed).toBe(true);
    });

    it('names the wallet when its scan stops before any chain', async () => {
        const task = createAddressDiscoveryTask();
        await task.start({
            walletIds: ['w1'],
            countChains: async () => 1,
            run: async () => { throw new Error('locked'); },
        });
        await settle(task);
        expect(task.status()).toMatchObject({ status: 'done', failedChains: ['this wallet'] });
    });
});
