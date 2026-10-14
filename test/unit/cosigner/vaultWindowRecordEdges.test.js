// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    UNRESOLVED_TICK_BUCKET,
    VaultWindowStore,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

describe('VaultWindowStore record boundaries', () => {
    it.each([
        { action: 1 },
        { tick: {} },
        { txid: false },
        { amount: Number.NaN },
        { amount: Number.POSITIVE_INFINITY },
    ])('rejects invalid entry fields without consuming budget', async (entry) => {
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence(),
            hours: 1,
            now: () => 5_000,
        });
        await store.load();

        expect(() => store.record(entry)).toThrow(/invalid/);
        expect(store.snapshot().count).toBe(0);
        expect(store.dirty).toBe(false);
    });

    it('accepts null optional fields and records a null transaction id', async () => {
        const persistence = createInMemoryWindowPersistence();
        const store = new VaultWindowStore({ persistence, hours: 1, now: () => 5_000 });
        await store.load();

        store.record({ action: null, tick: null, amount: null, txid: undefined });
        await store.flush();

        expect(store.snapshot()).toEqual({ count: 1, perTick: {} });
        expect(persistence.dump().entries[0]).toMatchObject({
            action: null,
            tick: null,
            amount: null,
            txid: null,
        });
    });

    it('retains entries exactly on the rolling-window cutoff', async () => {
        const now = 7_200_000;
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence({
                version: 1,
                entries: [{ t: now - 3_600_000, amount: '2' }],
            }),
            hours: 1,
            now: () => now,
        });
        await store.load();

        expect(store.snapshot()).toEqual({
            count: 1,
            perTick: { [UNRESOLVED_TICK_BUCKET]: '2' },
        });
        expect(store.dirty).toBe(false);
    });
});
