// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security regression (AutoLock): the extension popup's foreground idle timer
// stops when the popup closes, so a configured auto-lock never fired while the
// popup was closed. The background backstop enforces it. These tests pin the
// arm/disarm + activity accounting and the pure lock decision.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    readAutoLockState,
    applyAutoLockSignal,
    stampAutoLockActivity,
    clearAutoLockState,
    shouldAutoLock,
} from '../../../packages/extension/src/background/autoLockState.js';

// Minimal in-memory chrome.storage.session shim.
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
    return store;
}

describe('autoLockState.shouldAutoLock (pure)', () => {
    it('never locks when unarmed, missing, or without a positive idleMs/activity', () => {
        expect(shouldAutoLock(null, 1000)).toBe(false);
        expect(shouldAutoLock({ armed: false, idleMs: 100, lastActivity: 1 }, 1000)).toBe(false);
        expect(shouldAutoLock({ armed: true, idleMs: 0, lastActivity: 1 }, 1000)).toBe(false);
        expect(shouldAutoLock({ armed: true, idleMs: 100, lastActivity: 0 }, 1000)).toBe(false);
    });

    it('locks only once the idle window has elapsed since last activity', () => {
        const state = { armed: true, idleMs: 100, lastActivity: 1000 };
        expect(shouldAutoLock(state, 1099)).toBe(false); // 99 < 100
        expect(shouldAutoLock(state, 1100)).toBe(true);  // exactly at threshold
        expect(shouldAutoLock(state, 5000)).toBe(true);
    });
});

describe('autoLockState arm/stamp/clear', () => {
    beforeEach(() => { installSessionArea(); });

    it('arm stores armed + idleMs and stamps activity to now (full window)', async () => {
        await applyAutoLockSignal({ armed: true, idleMs: 900_000 }, 5000);
        const s = await readAutoLockState();
        expect(s).toEqual({ armed: true, idleMs: 900_000, lastActivity: 5000 });
        // A full window remains right after arming.
        expect(shouldAutoLock(s, 5000)).toBe(false);
    });

    it('disarm flips armed off so the alarm no-ops', async () => {
        await applyAutoLockSignal({ armed: true, idleMs: 1000 }, 1000);
        await applyAutoLockSignal({ armed: false }, 2000);
        const s = await readAutoLockState();
        expect(s.armed).toBe(false);
        expect(shouldAutoLock(s, 999_999)).toBe(false);
    });

    it('activity stamps only while armed', async () => {
        // Unarmed: stamp is a no-op.
        await applyAutoLockSignal({ armed: false }, 1000);
        await stampAutoLockActivity(4000);
        expect((await readAutoLockState()).lastActivity).toBe(1000);

        // Armed: stamp advances lastActivity, keeping the session alive.
        await applyAutoLockSignal({ armed: true, idleMs: 1000 }, 2000);
        await stampAutoLockActivity(2500);
        const s = await readAutoLockState();
        expect(s.lastActivity).toBe(2500);
        expect(shouldAutoLock(s, 3400)).toBe(false); // 900 < 1000 since last activity
        expect(shouldAutoLock(s, 3500)).toBe(true);  // 1000 since last activity
    });

    it('clear removes the state entirely', async () => {
        await applyAutoLockSignal({ armed: true, idleMs: 1000 }, 1000);
        await clearAutoLockState();
        expect(await readAutoLockState()).toBeNull();
    });

    it('a rejected/absent idleMs never arms a lock', async () => {
        await applyAutoLockSignal({ armed: true, idleMs: 'oops' }, 1000);
        const s = await readAutoLockState();
        expect(s.idleMs).toBe(0);
        expect(shouldAutoLock(s, 9_999_999)).toBe(false);
    });
});
