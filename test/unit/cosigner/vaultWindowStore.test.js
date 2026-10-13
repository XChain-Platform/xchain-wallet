// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: Vault-backed co-signer window store (§22, P4). Mirrors the SDK
// fs-backed store's contract: sync snapshot()/record() over an in-memory
// copy loaded async up front, fail-closed on corrupt state.

import { describe, it, expect } from 'vitest';
import {
    VaultWindowStore,
    WindowStateCorruptError,
    addDecimalStrings,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

describe('cosigner/addDecimalStrings', () => {
    it('adds decimal strings exactly', () => {
        expect(addDecimalStrings('0', '1.5')).toBe('1.5');
        expect(addDecimalStrings('1.5', '2.25')).toBe('3.75');
        expect(addDecimalStrings('0.00000001', '0.00000002')).toBe('0.00000003');
        expect(addDecimalStrings('99999999.99999999', '0.00000001')).toBe('100000000');
        expect(addDecimalStrings('100', '0')).toBe('100');
        expect(addDecimalStrings('1.50', '0')).toBe('1.5'); // canonical, trailing zero stripped
        expect(addDecimalStrings(2, 3)).toBe('5');
    });

    it('rejects non-decimal input', () => {
        expect(() => addDecimalStrings('abc', '1')).toThrow();
        expect(() => addDecimalStrings('1.2.3', '1')).toThrow();
        expect(() => addDecimalStrings('', '1')).toThrow();
    });
});

describe('cosigner/VaultWindowStore construction', () => {
    it('requires a persistence port and positive hours', () => {
        const p = createInMemoryWindowPersistence();
        expect(() => new VaultWindowStore({ persistence: p, hours: 24 })).not.toThrow();
        expect(() => new VaultWindowStore({ persistence: null, hours: 24 })).toThrow(/persistence/);
        expect(() => new VaultWindowStore({ persistence: p, hours: 0 })).toThrow(/hours/);
        expect(() => new VaultWindowStore({ persistence: {}, hours: 24 })).toThrow(/persistence/);
    });

    it('throws on snapshot()/record() before load()', () => {
        const store = new VaultWindowStore({ persistence: createInMemoryWindowPersistence(), hours: 24 });
        expect(() => store.snapshot()).toThrow(/load\(\)/);
        expect(() => store.record({ action: 'SEND' })).toThrow(/load\(\)/);
    });
});

describe('cosigner/VaultWindowStore load fail-closed', () => {
    it('starts empty when nothing is persisted', async () => {
        const store = new VaultWindowStore({ persistence: createInMemoryWindowPersistence(null), hours: 24 });
        await store.load();
        expect(store.snapshot()).toEqual({ count: 0, perTick: {} });
    });

    it('throws WindowStateCorruptError when entries is missing or not an array', async () => {
        for (const bad of [{ version: 1 }, { entries: 'nope' }, { entries: 42 }]) {
            const store = new VaultWindowStore({
                persistence: createInMemoryWindowPersistence(bad),
                hours: 24,
            });
            await expect(store.load()).rejects.toBeInstanceOf(WindowStateCorruptError);
        }
    });

    it('throws when an entry has no valid timestamp (never silently resets)', async () => {
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence({ version: 1, entries: [{ action: 'SEND' }] }),
            hours: 24,
        });
        await expect(store.load()).rejects.toBeInstanceOf(WindowStateCorruptError);
    });

    it('fails closed when the persistence read throws', async () => {
        const store = new VaultWindowStore({
            persistence: { async read() { throw new Error('disk gone'); }, async write() {} },
            hours: 24,
        });
        await expect(store.load()).rejects.toBeInstanceOf(WindowStateCorruptError);
    });

    it('rejects undefined reads and unsupported versions instead of resetting the budget', async () => {
        const undefinedStore = new VaultWindowStore({
            persistence: { async read() { return undefined; }, async write() {} },
            hours: 24,
        });
        const futureStore = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence({ version: 2, entries: [] }),
            hours: 24,
        });

        await expect(undefinedStore.load()).rejects.toBeInstanceOf(WindowStateCorruptError);
        await expect(futureStore.load()).rejects.toThrow(/unsupported version/);
    });

    it('rejects malformed or negative amounts instead of omitting them from per-tick usage', async () => {
        for (const amount of ['not-a-number', '-1']) {
            const store = new VaultWindowStore({
                persistence: createInMemoryWindowPersistence({
                    version: 1,
                    entries: [{ t: 1000, action: 'SEND', tick: 'X', amount }],
                }),
                hours: 24,
                now: () => 1000,
            });
            await expect(store.load()).rejects.toBeInstanceOf(WindowStateCorruptError);
        }
    });

    it('coalesces concurrent loads so a late read cannot replace live state', async () => {
        let reads = 0;
        let releaseRead;
        const readGate = new Promise((resolve) => { releaseRead = resolve; });
        const store = new VaultWindowStore({
            persistence: {
                async read() {
                    reads += 1;
                    await readGate;
                    return { version: 1, entries: [] };
                },
                async write() {},
            },
            hours: 24,
        });

        const first = store.load();
        const second = store.load();
        expect(reads).toBe(1);
        releaseRead();
        await Promise.all([first, second]);
        expect(store.snapshot().count).toBe(0);
    });
});

describe('cosigner/VaultWindowStore snapshot + record', () => {
    it('sums perTick amounts and counts entries', async () => {
        const now = () => 1_000_000_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [
                { t: now(), action: 'SEND', tick: 'XCHAIN', amount: '1.5' },
                { t: now(), action: 'SEND', tick: 'XCHAIN', amount: '2.25' },
                { t: now(), action: 'ISSUE', tick: 'FOO', amount: '10' },
                { t: now(), action: 'BROADCAST' }, // no tick/amount: counted, not summed
            ],
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now });
        await store.load();
        const snap = store.snapshot();
        expect(snap.count).toBe(4);
        expect(snap.perTick).toEqual({ XCHAIN: '3.75', FOO: '10' });
    });

    it('sums ticker case variants into the chain identity bucket', async () => {
        const now = () => 1_000_000_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [
                { t: now(), action: 'SEND', tick: 'MiXeD', amount: '1.5' },
                { t: now(), action: 'SEND', tick: 'MIXED', amount: '2.25' },
                { t: now(), action: 'SEND', tick: '__proto__', amount: '3' },
            ],
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now });
        await store.load();

        expect(store.snapshot().perTick).toEqual({ MIXED: '3.75', __PROTO__: '3' });
    });

    it('prunes entries older than the window', async () => {
        const nowMs = 1_000_000_000_000;
        const hourMs = 3600 * 1000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [
                { t: nowMs - 30 * hourMs, action: 'SEND', tick: 'X', amount: '5' }, // older than 24h -> pruned
                { t: nowMs - 1 * hourMs, action: 'SEND', tick: 'X', amount: '7' },   // within window
            ],
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => nowMs });
        await store.load();
        const snap = store.snapshot();
        expect(snap.count).toBe(1);
        expect(snap.perTick).toEqual({ X: '7' });
    });

    it('persists pruning so expired entries cannot reappear after reload', async () => {
        const nowMs = 1_000_000_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [{ t: nowMs - 25 * 3600 * 1000, action: 'SEND', tick: 'X', amount: '5' }],
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => nowMs });
        await store.load();

        expect(store.snapshot().count).toBe(0);
        expect(store.dirty).toBe(true);
        await store.flush();

        const reopened = new VaultWindowStore({ persistence, hours: 24, now: () => nowMs - 2 * 3600 * 1000 });
        await reopened.load();
        expect(reopened.snapshot().count).toBe(0);
    });

    it('consumes budget in memory immediately, then persists on flush', async () => {
        const nowMs = 2_000_000_000_000;
        const persistence = createInMemoryWindowPersistence(null);
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => nowMs });
        await store.load();

        expect(store.dirty).toBe(false);
        store.record({ action: 'SEND', tick: 'X', amount: '4', txid: 'deadbeef' });
        expect(store.dirty).toBe(true);
        // visible synchronously to a subsequent snapshot (no flush needed)
        expect(store.snapshot()).toEqual({ count: 1, perTick: { X: '4' } });
        // not yet persisted
        expect(persistence.dump()).toBeNull();

        await store.flush();
        expect(store.dirty).toBe(false);
        const dumped = persistence.dump();
        expect(dumped.entries).toHaveLength(1);
        expect(dumped.entries[0]).toMatchObject({ action: 'SEND', tick: 'X', amount: '4', txid: 'deadbeef', t: nowMs });

        // a fresh store over the same persistence sees the recorded entry
        const reopened = new VaultWindowStore({ persistence, hours: 24, now: () => nowMs });
        await reopened.load();
        expect(reopened.snapshot()).toEqual({ count: 1, perTick: { X: '4' } });
    });

    it('persists a record added while a flush is in flight', async () => {
        let stored = null;
        let releaseWrite;
        let markWriteStarted;
        const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
        const writeStarted = new Promise((resolve) => { markWriteStarted = resolve; });
        let writes = 0;
        const persistence = {
            async read() { return null; },
            async write(state) {
                writes += 1;
                if (writes === 1) {
                    markWriteStarted();
                    await writeGate;
                }
                stored = JSON.parse(JSON.stringify(state));
            },
        };
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => 2000 });
        await store.load();
        store.record({ action: 'SEND', tick: 'X', amount: '1' });

        const flushing = store.flush();
        await writeStarted;
        store.record({ action: 'SEND', tick: 'X', amount: '2' });
        releaseWrite();
        await flushing;

        expect(writes).toBe(2);
        expect(stored.entries).toHaveLength(2);
        expect(store.dirty).toBe(false);
    });

    it('rejects invalid amounts before adding a record', async () => {
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence(),
            hours: 24,
        });
        await store.load();

        expect(() => store.record({ action: 'SEND', tick: 'X', amount: '-1' })).toThrow(/negative amount/);
        expect(() => store.record({ action: 'SEND', tick: 'X', amount: {} })).toThrow(/invalid amount/);
        expect(store.snapshot().count).toBe(0);
        expect(store.dirty).toBe(false);
    });

    it('flush is a no-op when nothing was recorded (deny path leaves no write)', async () => {
        const persistence = createInMemoryWindowPersistence(null);
        let writes = 0;
        const counting = {
            read: persistence.read,
            async write(s) { writes += 1; return persistence.write(s); },
        };
        const store = new VaultWindowStore({ persistence: counting, hours: 24 });
        await store.load();
        store.snapshot(); // deny path: only reads usage
        await store.flush();
        expect(writes).toBe(0);
    });
});
