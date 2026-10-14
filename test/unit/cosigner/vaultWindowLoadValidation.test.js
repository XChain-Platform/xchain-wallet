// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    VaultWindowStore,
    WindowStateCorruptError,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

function persistenceReturning(value) {
    return {
        async read() { return value; },
        async write() {},
    };
}

describe('VaultWindowStore persisted-state validation', () => {
    it.each([
        { state: { version: 1, entries: [], lastSeen: -1 }, message: /lastSeen/ },
        { state: { version: 1, entries: [], lastSeen: Number.NaN }, message: /lastSeen/ },
        { state: { version: 1, entries: [null] }, message: /timestamp/ },
        { state: { version: 1, entries: [[]] }, message: /timestamp/ },
        { state: { version: 1, entries: [{ t: Number.POSITIVE_INFINITY }] }, message: /timestamp/ },
        { state: { version: 1, entries: [{ t: 1, action: 4 }] }, message: /action/ },
        { state: { version: 1, entries: [{ t: 1, tick: false }] }, message: /tick/ },
        { state: { version: 1, entries: [{ t: 1, txid: 9 }] }, message: /txid/ },
        { state: { version: 1, entries: [{ t: 1, amount: {} }] }, message: /amount/ },
    ])('fails closed for $message', async ({ state, message }) => {
        const store = new VaultWindowStore({
            persistence: persistenceReturning(state),
            hours: 1,
            now: () => 1,
        });

        await expect(store.load()).rejects.toMatchObject({
            name: 'WindowStateCorruptError',
            code: 'WINDOW_STATE_CORRUPT',
        });
        await expect(store.load()).rejects.toThrow(message);
    });

    it('allows a retry after a transient read failure', async () => {
        let reads = 0;
        const store = new VaultWindowStore({
            persistence: {
                async read() {
                    reads += 1;
                    if (reads === 1) throw 'temporarily unavailable';
                    return null;
                },
                async write() {},
            },
            hours: 1,
        });

        await expect(store.load()).rejects.toBeInstanceOf(WindowStateCorruptError);
        await expect(store.load()).resolves.toBeUndefined();
        expect(reads).toBe(2);
        expect(store.snapshot().count).toBe(0);
    });
});
