// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    VaultWindowStore,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

const MINUTE = 60 * 1000;

describe('VaultWindowStore clock boundaries', () => {
    it('accepts timestamps exactly at the skew tolerance', async () => {
        const now = 10_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [{ t: now + MINUTE, action: 'SEND', tick: 'X', amount: '1' }],
            lastSeen: now + MINUTE,
        });
        const store = new VaultWindowStore({ persistence, hours: 1, now: () => now });

        await store.load();

        expect(store.clockWarnings()).toEqual([]);
        expect(store.dirty).toBe(false);
        expect(store.snapshot()).toEqual({ count: 1, perTick: { X: '1' } });
    });

    it('rejects invalid clocks wherever wall time is consumed', async () => {
        const loadedFromEmpty = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence(),
            hours: 1,
            now: () => -1,
        });
        await loadedFromEmpty.load();
        expect(() => loadedFromEmpty.snapshot()).toThrow(/clock/);

        const loadedFromState = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence({ version: 1, entries: [] }),
            hours: 1,
            now: () => Number.NaN,
        });
        await expect(loadedFromState.load()).rejects.toThrow(/clock/);
    });

    it('returns defensive copies of warning and quarantine lists', async () => {
        const now = 10_000_000;
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence({
                version: 1,
                entries: [{ t: now + MINUTE + 1, amount: '1' }],
            }),
            hours: 1,
            now: () => now,
        });
        await store.load();

        const warnings = store.clockWarnings();
        warnings.length = 0;
        const quarantined = store.quarantined();
        quarantined.push({ t: now });

        expect(store.clockWarnings()).toHaveLength(1);
        expect(store.quarantined()).toEqual([]);
    });
});
