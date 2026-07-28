// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// The wallet half of the stage-2 co-signer hardening: the Vault-backed window
// store must accumulate unresolved-tick entries under the same reserved bucket
// the SDK evaluator reads (G8), and must notice a misbehaving host clock (G19).
// A divergence here is silent: the SDK reads a total of '0' and every wildcard
// window cap quietly degrades into a per-transaction cap.

import { describe, it, expect } from 'vitest';
import {
    VaultWindowStore,
    createInMemoryWindowPersistence,
    UNRESOLVED_TICK_BUCKET,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';

const HOUR = 3600 * 1000;

describe('VaultWindowStore G8: unresolved-tick accumulation', () => {

    it('accumulates entries with no tick under the reserved bucket', async () => {
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence(), hours: 24,
        });
        await store.load();
        store.record({ action: 'COLLECT', amount: '6', txid: null });
        store.record({ action: 'COLLECT', amount: '4', txid: null });

        const snap = store.snapshot();
        expect(snap.count).toBe(2);
        // Before the fix these were skipped entirely, so the used total read '0'
        // forever and a wildcard window cap bound each transaction independently.
        expect(snap.perTick[UNRESOLVED_TICK_BUCKET]).toBe('10');
    });

    it('keeps resolved ticks under their own name', async () => {
        const store = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence(), hours: 24,
        });
        await store.load();
        store.record({ action: 'SEND', tick: 'TOK', amount: '3' });
        store.record({ action: 'COLLECT', amount: '7' });

        const snap = store.snapshot();
        expect(snap.perTick.TOK).toBe('3');
        expect(snap.perTick[UNRESOLVED_TICK_BUCKET]).toBe('7');
    });

    it('uses a bucket name no real tick can collide with', () => {
        // '|' is the action-string field separator: a tick containing one would
        // corrupt the wire format itself.
        expect(UNRESOLVED_TICK_BUCKET).toContain('|');
    });
});

describe('VaultWindowStore G19: clock guards', () => {

    it('clamps a future-dated entry rather than letting it outlive the window', async () => {
        const now = 1_800_000_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [{ t: now + 90 * 24 * HOUR, action: 'SEND', tick: 'TOK', amount: '5' }],
            lastSeen: now,
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => now });
        await store.load();

        // Still counted (clamping tightens the budget; dropping would loosen it).
        expect(store.snapshot().perTick.TOK).toBe('5');
        expect(store.clockWarnings().join(' ')).toMatch(/future/);
    });

    it('reports a backward clock step across a reload', async () => {
        const now = 1_800_000_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1, entries: [], lastSeen: now + HOUR,
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => now });
        await store.load();
        expect(store.clockWarnings().join(' ')).toMatch(/backward/);
    });

    it('stays quiet under ordinary jitter', async () => {
        const now = 1_800_000_000_000;
        const persistence = createInMemoryWindowPersistence({
            version: 1,
            entries: [{ t: now + 5_000, action: 'SEND', tick: 'TOK', amount: '5' }],
            lastSeen: now + 5_000,
        });
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => now });
        await store.load();
        expect(store.clockWarnings()).toHaveLength(0);
    });

    it('persists lastSeen so the next load can detect a step', async () => {
        const now = 1_800_000_000_000;
        const persistence = createInMemoryWindowPersistence();
        const store = new VaultWindowStore({ persistence, hours: 24, now: () => now });
        await store.load();
        store.record({ action: 'SEND', tick: 'TOK', amount: '1' });
        await store.flush();
        expect(persistence.dump().lastSeen).toBe(now);
    });
});

describe('passiveCoSign wire collapse (wallet edge)', () => {

    it('wraps a single-input request into the one-shape the daemon accepts', async () => {
        // The daemon takes exactly one request shape so every gate has a single
        // validation path; the single-input convenience lives at the client edge,
        // which for bridge callers is this flow.
        const { passiveCoSign } = await import('../../../packages/core/src/flows/passiveCoSign.js');
        let seen = null;
        const sdk = {
            coSigner: {
                CoSigner: class {
                    process(req) { seen = req; return { approved: true, action: 'SEND', signatures: [] }; }
                },
            },
        };
        await passiveCoSign({
            sdk,
            secretKey: new Uint8Array(32).fill(7),
            publicKeys: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
            policy: { allowedActions: ['SEND'] },
            request: { psbt: 'aabb', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 2 },
        });
        expect(seen.inputs).toHaveLength(1);
        expect(seen.inputs[0].index).toBe(2);
        expect(seen.inputs[0].agentPublicNonce).toBe('03' + 'c'.repeat(130));
        expect(seen.agentPublicNonce).toBeUndefined();
    });

    it('passes an explicit inputs array through untouched', async () => {
        const { passiveCoSign } = await import('../../../packages/core/src/flows/passiveCoSign.js');
        let seen = null;
        const sdk = {
            coSigner: {
                CoSigner: class {
                    process(req) { seen = req; return { approved: true, action: 'SEND', signatures: [] }; }
                },
            },
        };
        const inputs = [{ index: 0, agentPublicNonce: 'aa' }, { index: 3, agentPublicNonce: 'bb' }];
        await passiveCoSign({
            sdk,
            secretKey: new Uint8Array(32).fill(7),
            publicKeys: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
            policy: { allowedActions: ['SEND'] },
            request: { psbt: 'aabb', inputs },
        });
        expect(seen.inputs).toBe(inputs);
    });
});
