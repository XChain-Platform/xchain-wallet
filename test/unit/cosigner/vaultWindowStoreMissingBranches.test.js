// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    VaultWindowStore,
    addDecimalStrings,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

describe('vault window store remaining branches', () => {
    it('formats a negative whole-number result without a decimal scale', () => {
        expect(addDecimalStrings('-1', '-2')).toBe('-3');
    });

    it('reports no clock warnings before loading and treats a repeated load as a no-op', async () => {
        let reads = 0;
        const store = new VaultWindowStore({
            persistence: {
                async read() {
                    reads += 1;
                    return null;
                },
                async write() {},
            },
            hours: 1,
        });

        expect(store.clockWarnings()).toEqual([]);
        await store.load();
        await store.load();

        expect(reads).toBe(1);
    });

    it('uses the current clock as lastSeen when flushing an unstamped dirty state', async () => {
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [{ t: 1_000, amount: '1' }],
        });
        const store = new VaultWindowStore({ persistence, hours: 1, now: () => 5_000_000 });

        await store.load();
        expect(store.snapshot()).toEqual({ count: 0, perTick: {} });
        await store.flush();

        expect(persistence.dump().lastSeen).toBe(5_000_000);
    });
});
