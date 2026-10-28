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

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { readAutoLockState } from '../../../packages/extension/src/background/autoLockState.js';
import { reportAutoLock } from '../../../packages/extension/src/popup/messaging.js';

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

    it('drops a disarm issued before the arm on record', async () => {
        const host = makeHost();
        installSessionArea();
        await report(host, { armed: true, idleMs: 60_000, issuedAt: T0 + 2_000 }, T0 + 2_000);

        await report(host, { armed: false, idleMs: 60_000, issuedAt: T0 }, T0 + 2_300);

        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 60_000, lastActivity: T0 + 2_000 });
    });

    it('applies a disarm issued after the arm on record', async () => {
        const host = makeHost();
        installSessionArea();
        await report(host, { armed: true, idleMs: 60_000, issuedAt: T0 }, T0);
        // Activity keeps the arm stamp, so a later disarm still applies.
        await report(host, { armed: true, idleMs: 60_000, activity: true, issuedAt: T0 + 5_000 }, T0 + 5_000);

        await report(host, { armed: false, idleMs: 60_000, issuedAt: T0 + 1_000 }, T0 + 6_000);

        expect((await readAutoLockState())?.armed).toBe(false);
    });

    it('applies an arm whatever its stamp, so a clock set back never leaves the session disarmed', async () => {
        const host = makeHost();
        installSessionArea();
        await report(host, { armed: true, idleMs: 60_000, issuedAt: T0 }, T0);
        await report(host, { armed: false, issuedAt: T0 + 1_000 }, T0 + 1_000);

        await report(host, { armed: true, idleMs: 60_000, issuedAt: T0 - 3_600_000 }, T0 + 2_000);

        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 60_000 });
    });
});

// The popup reports through chromeMessaging, which repeats a `session.autolock`
// whose port dropped. The Locked screen's disarm finds no host and drops; its
// last repeat can reach the host the unlock built after the unlocked screen
// armed it. Each report is stamped when issued, as useAutoLockPolicy does.
describe('session.autolock across an unlock (popup messaging into the route)', () => {
    afterEach(() => {
        delete globalThis.chrome;
        vi.useRealTimers();
    });

    it('keeps the unlocked arm when the Locked screen disarm lands after it', async () => {
        vi.useFakeTimers({ now: T0 });
        installSessionArea();
        const area = globalThis.chrome.storage.session;
        const host = makeHost();
        let hostUp = false;
        globalThis.chrome = {
            storage: { session: area },
            runtime: {
                lastError: undefined,
                sendMessage(message, callback) {
                    const rt = globalThis.chrome.runtime;
                    if (!hostUp) {
                        // No host listener: Chrome closes the port.
                        queueMicrotask(() => {
                            rt.lastError = { message: 'The message port closed before a response was received.' };
                            callback(undefined);
                            rt.lastError = undefined;
                        });
                        return;
                    }
                    host.handle(message).then((response) => callback(response));
                },
            },
        };

        // Locked screen: the disarm drops and waits to repeat.
        const disarm = reportAutoLock({ armed: false, idleMs: 60_000, issuedAt: Date.now() });
        await vi.advanceTimersByTimeAsync(600);

        // The unlock builds the host, clears the old deadline, and the
        // unlocked screen arms.
        hostUp = true;
        await area.remove('xchain:autolock');
        await reportAutoLock({ armed: true, idleMs: 60_000, issuedAt: Date.now() });

        // The disarm's last repeat lands after the arm.
        await vi.advanceTimersByTimeAsync(2_000);
        await disarm;

        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 60_000 });
    });
});
