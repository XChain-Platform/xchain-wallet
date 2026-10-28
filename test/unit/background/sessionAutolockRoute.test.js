// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Drive the extension's registered `session.autolock` route, not the state
// helper behind it, so a handler that rebuilds the signal without the
// foreground `activity` flag is caught where the popup actually reaches it.

import { describe, it, expect, afterEach } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { readAutoLockState } from '../../../packages/extension/src/background/autoLockState.js';

// Build a host with every persistence adapter on its in-memory path.
function makeHost(extra = {}) {
    return createBackgroundHost({
        ...extra,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [{ id: 'w1', name: 'Main' }] },
        },
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
    });
}

// Install an in-memory chrome.storage.session, the area the route writes.
function installSessionArea() {
    const store = new Map();
    globalThis.chrome = {
        storage: {
            session: {
                async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
                async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
                async remove(key) { store.delete(key); },
            },
        },
    };
}

// Send one auto-lock report through the host with the clock pinned to `at`.
async function report(host, request, at) {
    const realNow = Date.now;
    Date.now = () => at;
    try {
        return await host.handle({ type: 'session.autolock', request });
    } finally {
        Date.now = realNow;
    }
}

const T0 = 1_700_000_000_000;

describe('session.autolock route (extension service worker)', () => {
    afterEach(() => { delete globalThis.chrome; });

    it('moves the idle clock forward on a foreground activity report', async () => {
        const host = makeHost();
        installSessionArea();
        await report(host, { armed: true, idleMs: 60_000 }, T0);

        const res = await report(host, { armed: true, idleMs: 60_000, activity: true }, T0 + 30_000);

        expect(res.ok).toBe(true);
        expect(await readAutoLockState()).toEqual({ armed: true, idleMs: 60_000, lastActivity: T0 + 30_000 });
    });

    it('keeps the activity stamp on a timeout change that carries no activity flag', async () => {
        const host = makeHost();
        installSessionArea();
        await report(host, { armed: true, idleMs: 60_000 }, T0);

        await report(host, { armed: true, idleMs: 30_000 }, T0 + 30_000);

        expect(await readAutoLockState()).toEqual({ armed: true, idleMs: 30_000, lastActivity: T0 });
    });

    it('locks and replies unsaved when storage refuses the arm', async () => {
        const locks = [];
        const host = makeHost({ onAutoLockArmRefused: async () => { locks.push('lock'); } });
        installSessionArea();
        globalThis.chrome.storage.session.set = async () => { throw new Error('quota exceeded'); };

        const res = await report(host, { armed: true, idleMs: 60_000 }, T0);

        expect(res.ok).toBe(true);
        expect(res.result).toEqual({ ok: false, reason: 'auto-lock-unsaved' });
        expect(locks).toEqual(['lock']);
    });

    it('does not lock on a refused activity report', async () => {
        const locks = [];
        const host = makeHost({ onAutoLockArmRefused: async () => { locks.push('lock'); } });
        installSessionArea();
        await report(host, { armed: true, idleMs: 60_000 }, T0);
        globalThis.chrome.storage.session.set = async () => { throw new Error('quota exceeded'); };

        const res = await report(host, { armed: true, idleMs: 60_000, activity: true }, T0 + 1_000);

        expect(res.result).toEqual({ ok: true });
        expect(locks).toEqual([]);
    });

    it('does not let an activity report re-arm a disarmed record', async () => {
        const host = makeHost();
        installSessionArea();
        await report(host, { armed: false }, T0);

        await report(host, { armed: true, idleMs: 60_000, activity: true }, T0 + 30_000);

        expect((await readAutoLockState())?.armed).toBe(false);
    });
});
