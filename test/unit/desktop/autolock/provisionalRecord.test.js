/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A desktop window can sit on the 25th-word capture or the post-create notice
// without ever reaching the unlocked screen, so the renderer never reports and
// an OS screen lock or suspend found no record to enforce.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    FileAutoLockStore,
    applyAutoLockReport,
    armProvisionalAutoLock,
    autoLockStatePathFor,
} from '../../../../packages/desktop/main/autoLockState.js';
import {
    createRuntime,
    enforceIdleAutoLock,
    enforceSystemAutoLock,
} from '../../../../packages/desktop/main/runtime.js';

const MINUTE = 60 * 1000;
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-provlock-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function unlockedRuntime(store) {
    const noop = { load: async () => null, save: async () => {}, clear: async () => {} };
    const runtime = createRuntime({
        storageBackend: noop,
        metaBackend: noop,
        sessionBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
        autoLockStore: store,
        chainRegistry: {},
        sdkRegistry: {},
    });
    runtime.vault = { close: vi.fn() };
    runtime.signerPool = { lockAll: vi.fn() };
    runtime.host = { handle: vi.fn() };
    return runtime;
}

describe('desktop provisional auto-lock record', () => {
    it('lets an OS lock or the idle window end a session the renderer never reported for', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        const runtime = unlockedRuntime(store);
        const t0 = Date.now();
        expect(await enforceSystemAutoLock(runtime)).toEqual({ locked: false, reason: 'no-record' });

        await armProvisionalAutoLock(store, async () => ({ autolockMinutes: 5 }), t0);

        expect(await store.load()).toEqual({ armed: true, idleMs: 5 * MINUTE, lastActivity: t0 });
        expect(await enforceIdleAutoLock(runtime, t0 + 2 * MINUTE)).toEqual({ locked: false, reason: 'within-window' });
        expect(await enforceIdleAutoLock(runtime, t0 + 6 * MINUTE)).toEqual({ locked: true, reason: 'idle-window-elapsed' });
    });

    it('ends on an OS lock while the renderer is still on a pre-unlocked screen', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        const runtime = unlockedRuntime(store);
        await armProvisionalAutoLock(store, () => ({ autolockMinutes: 30 }), Date.now());

        expect(await enforceSystemAutoLock(runtime)).toEqual({ locked: true, reason: 'system-event' });
        expect(runtime.host).toBe(null);
    });

    it('keeps Never disarmed, and the renderer report replaces the record', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        const runtime = unlockedRuntime(store);
        await armProvisionalAutoLock(store, () => ({ autolockMinutes: 0 }), 1_000);
        expect(await enforceSystemAutoLock(runtime)).toEqual({ locked: false, reason: 'disarmed' });

        await armProvisionalAutoLock(store, () => ({ autolockMinutes: 15 }), 2_000);
        await applyAutoLockReport(store, { armed: true, idleMs: 3 * MINUTE }, 3_000);
        expect(await store.load()).toMatchObject({ armed: true, idleMs: 3 * MINUTE });
    });

    it('takes the default window when settings cannot be read', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        await armProvisionalAutoLock(store, () => { throw new Error('no vault'); }, 4_000);

        expect(await store.load()).toEqual({ armed: true, idleMs: 15 * MINUTE, lastActivity: 4_000 });
    });

    it('arms after the host build inside the unlock hook, through the store lane', () => {
        const source = readFileSync(join(__dirname, '../../../../packages/desktop/main/runtime.js'), 'utf8');
        const hook = source.slice(source.indexOf('onUnlocked: async () => {'));
        const ensure = hook.indexOf('await ensureHost(runtime)');
        const arm = hook.indexOf('armProvisionalAutoLock(');
        expect(ensure).toBeGreaterThan(-1);
        expect(arm).toBeGreaterThan(ensure);
        expect(hook.slice(ensure, arm)).toContain('withAutoLockStoreLane(runtime');
    });
});
