// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { VaultWindowStore } from '../../../packages/core/src/cosigner/vaultWindowStore.js';

describe('VaultWindowStore flush recovery', () => {
    it('coalesces concurrent failures and remains dirty for retry', async () => {
        let writes = 0;
        let stored;
        const store = new VaultWindowStore({
            persistence: {
                async read() { return null; },
                async write(state) {
                    writes += 1;
                    if (writes === 1) throw new Error('write refused');
                    stored = state;
                },
            },
            hours: 1,
            now: () => 9_000,
        });
        await store.load();
        store.record({ action: 'SEND', tick: 'X', amount: '3' });

        const first = store.flush();
        const second = store.flush();
        await expect(first).rejects.toThrow(/write refused/);
        await expect(second).rejects.toThrow(/write refused/);
        expect(writes).toBe(1);
        expect(store.dirty).toBe(true);

        await expect(store.flush()).resolves.toBeUndefined();
        expect(writes).toBe(2);
        expect(store.dirty).toBe(false);
        expect(stored.entries).toHaveLength(1);
    });

    it('isolates live state from mutation by the persistence port', async () => {
        const store = new VaultWindowStore({
            persistence: {
                async read() { return null; },
                async write(state) {
                    state.entries[0].amount = '999';
                    state.entries.push({ t: 9_000, amount: '999' });
                },
            },
            hours: 1,
            now: () => 9_000,
        });
        await store.load();
        store.record({ action: 'SEND', tick: 'X', amount: '3' });

        await store.flush();

        expect(store.snapshot()).toEqual({ count: 1, perTick: { X: '3' } });
    });
});
