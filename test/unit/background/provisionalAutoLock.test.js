// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An unlocked session needs a deadline before any popup reports. Unlock,
// create and import clear the record and leave arming to the foreground, so a
// popup that closes mid-unlock, or waits on a screen that never reaches the
// unlocked state, left a session no alarm could ever lock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    applyAutoLockSignal,
    armProvisionalAutoLock,
    armedOrLocked,
    clearAutoLockState,
    readAutoLockState,
    shouldAutoLock,
} from '../../../packages/extension/src/background/autoLockState.js';
import { provisionalAutoLockSignal } from '../../../packages/core/src/shared/hooks/autoLockGuard.js';
import { resolveAutoLockMinutes } from '../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';

const MINUTE = 60 * 1000;

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

describe('provisionalAutoLockSignal', () => {
    it('sizes the window from the vault timeout and disarms Never', () => {
        expect(provisionalAutoLockSignal({ autolockMinutes: 5 })).toEqual({ armed: true, idleMs: 5 * MINUTE });
        expect(provisionalAutoLockSignal({ autolockMinutes: 0 })).toEqual({ armed: false, idleMs: 0 });
    });

    it('falls back to the default window when settings are missing or unusable', () => {
        for (const settings of [null, undefined, {}, { autolockMinutes: null }, { autolockMinutes: -3 }, { autolockMinutes: 'x' }]) {
            expect(provisionalAutoLockSignal(settings)).toEqual({ armed: true, idleMs: 15 * MINUTE });
        }
    });

    it('keeps the hook export pointing at the same normaliser', () => {
        expect(resolveAutoLockMinutes(0)).toBe(0);
        expect(resolveAutoLockMinutes(99999)).toBe(1440);
        expect(resolveAutoLockMinutes(null)).toBe(15);
    });
});

describe('extension provisional auto-lock record', () => {
    beforeEach(() => { installSessionArea(); });

    it('locks an unlocked session no foreground ever reported for', async () => {
        await clearAutoLockState();
        const t0 = 1_000_000;
        expect(shouldAutoLock(await readAutoLockState(), t0 + 60 * MINUTE)).toBe(false);

        await armProvisionalAutoLock(async () => ({ autolockMinutes: 10 }), t0);

        const state = await readAutoLockState();
        expect(state).toMatchObject({ armed: true, idleMs: 10 * MINUTE, lastActivity: t0 });
        expect(shouldAutoLock(state, t0 + 9 * MINUTE)).toBe(false);
        expect(shouldAutoLock(state, t0 + 10 * MINUTE)).toBe(true);
    });

    it('leaves Never disarmed so the session stays open', async () => {
        await armProvisionalAutoLock(() => ({ autolockMinutes: 0 }), 5_000);

        const state = await readAutoLockState();
        expect(state).toMatchObject({ armed: false });
        expect(shouldAutoLock(state, 5_000 + 600 * MINUTE)).toBe(false);
    });

    it('takes the default window when the settings read fails', async () => {
        await armProvisionalAutoLock(() => { throw new Error('vault closed'); }, 7_000);

        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 15 * MINUTE, lastActivity: 7_000 });
    });

    it('is replaced by the foreground first report, a disarm included', async () => {
        await armProvisionalAutoLock(() => ({ autolockMinutes: 15 }), 1_000);
        await applyAutoLockSignal({ armed: false, issuedAt: 2_000 }, 2_000);
        expect(await readAutoLockState()).toMatchObject({ armed: false });

        await armProvisionalAutoLock(() => ({ autolockMinutes: 15 }), 3_000);
        await applyAutoLockSignal({ armed: true, idleMs: 2 * MINUTE, issuedAt: 4_000 }, 4_000);
        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 2 * MINUTE });
    });

    it('still locks when storage refuses the provisional record', async () => {
        globalThis.chrome.storage.session.set = async () => { throw new Error('quota'); };

        const result = await armProvisionalAutoLock(() => ({ autolockMinutes: 1 }), 9_000);

        expect(result.saved).toBe(false);
        expect(shouldAutoLock(await readAutoLockState(), 9_000 + MINUTE)).toBe(true);
    });
});

describe('unlock wiring', () => {
    it('arms the provisional record after the host build and before unlocked is published', () => {
        const source = readFileSync(join(__dirname, '../../../packages/extension/src/background.js'), 'utf8');
        const unlocked = source.slice(source.indexOf('onUnlocked: () => {'));
        const ensure = unlocked.indexOf('continueUnlock: () => ensureHost()');
        const arm = unlocked.indexOf('armProvisionalAutoLock(');
        const publish = unlocked.indexOf("publish('session', { state: 'unlocked' })");
        expect(ensure).toBeGreaterThan(-1);
        expect(arm).toBeGreaterThan(ensure);
        expect(publish).toBeGreaterThan(arm);
    });
});

describe('unlock path on a refused provisional record', () => {
    beforeEach(() => { installSessionArea(); });

    const quietLogger = () => ({ error: vi.fn() });

    it('reports the record held and never locks when storage takes it', async () => {
        const onRefused = vi.fn(async () => {});
        const held = await armedOrLocked(() => armProvisionalAutoLock(() => ({ autolockMinutes: 5 }), 1_000), onRefused);

        expect(held).toBe(true);
        expect(onRefused).not.toHaveBeenCalled();
        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 5 * MINUTE });
    });

    it('locks once and withholds unlocked when storage refuses the record', async () => {
        globalThis.chrome.storage.session.set = async () => { throw new Error('quota'); };
        const onRefused = vi.fn(async () => {});

        const held = await armedOrLocked(() => armProvisionalAutoLock(() => ({ autolockMinutes: 5 }), 1_000), onRefused);

        expect(held).toBe(false);
        expect(onRefused).toHaveBeenCalledOnce();
    });

    it('a refused record is gone after a worker restart, which is why the unlock locks', async () => {
        globalThis.chrome.storage.session.set = async () => { throw new Error('quota'); };
        await armProvisionalAutoLock(() => ({ autolockMinutes: 1 }), 9_000);
        vi.resetModules();
        const restarted = await import('../../../packages/extension/src/background/autoLockState.js');

        expect(await restarted.readAutoLockState()).toBeNull();
    });

    it('locks when the arm itself rejects, and logs it', async () => {
        const onRefused = vi.fn(async () => {});
        const logger = quietLogger();

        const held = await armedOrLocked(async () => { throw new Error('boom'); }, onRefused, logger);

        expect(held).toBe(false);
        expect(onRefused).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('still resolves when the lock after a refusal throws', async () => {
        const logger = quietLogger();
        const held = await armedOrLocked(async () => ({ saved: false }), async () => { throw new Error('lock'); }, logger);

        expect(held).toBe(false);
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('background.js gates the unlocked publish on a held record', () => {
        const source = readFileSync(join(__dirname, '../../../packages/extension/src/background.js'), 'utf8');
        const unlocked = source.slice(source.indexOf('onUnlocked: () => {'), source.indexOf('startLabelSyncRestore:'));
        expect(unlocked).toContain('armedOrLocked(');
        expect(unlocked).toContain('lockAfterRefusedAutoLockArm,');
        expect(unlocked).toContain("if (built && armed) await surfaceStateEvents.publish('session', { state: 'unlocked' });");
        expect(source).toContain('onAutoLockArmRefused: lockAfterRefusedAutoLockArm,');
    });
});
