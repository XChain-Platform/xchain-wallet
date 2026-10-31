/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isAutoLockArmRefused } from '../../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';
import {
    AUTO_LOCK_REPORT_TYPE,
    createRuntime,
    handleIpcMessage,
} from '../../../../packages/desktop/main/runtime.js';

function backend(initial = null) {
    let value = initial;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        clear: vi.fn(async () => { value = null; }),
    };
}

function runtimeWithRefusingStore(state = { armed: false, idleMs: 0, lastActivity: 1 }) {
    let record = state;
    const sessionBackend = backend(new Uint8Array([1, 2, 3]));
    const autoLockStore = {
        load: vi.fn(async () => record),
        save: vi.fn(async () => { throw new Error('write refused'); }),
        clear: vi.fn(async () => { record = null; }),
    };
    const runtime = createRuntime({
        storageBackend: backend(),
        metaBackend: backend(),
        sessionBackend,
        autoLockStore,
        chainRegistry: {},
        sdkRegistry: {},
    });
    return { runtime, sessionBackend, autoLockStore };
}

describe('desktop refused auto-lock arm', () => {
    it('locks and returns the shared refusal reply when an arm cannot be saved', async () => {
        const { runtime, sessionBackend, autoLockStore } = runtimeWithRefusingStore();
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs: 15 * 60_000 },
        });

        expect(response.ok).toBe(true);
        expect(isAutoLockArmRefused(response.result)).toBe(true);
        expect(response.result).toEqual({ ok: false, reason: 'auto-lock-unsaved' });
        expect(await sessionBackend.load()).toBeNull();
        expect(autoLockStore.clear).toHaveBeenCalled();
        expect(await autoLockStore.load()).toBeNull();
        expect(errorLog).toHaveBeenCalledWith(
            '[xchain] auto-lock arm could not be saved:',
            expect.any(Error),
        );
    });

    it('clears the stale record even when the cached key cannot be deleted', async () => {
        const { runtime, sessionBackend, autoLockStore } = runtimeWithRefusingStore();
        sessionBackend.clear.mockRejectedValue(new Error('delete refused'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs: 15 * 60_000 },
        });

        expect(isAutoLockArmRefused(response.result)).toBe(true);
        expect(runtime.autoLockCleanupPending).toBe(true);
        expect(await autoLockStore.load()).toBeNull();
        expect(await sessionBackend.load()).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('does not lock when only an activity stamp is refused', async () => {
        const { runtime, sessionBackend } = runtimeWithRefusingStore({
            armed: true,
            idleMs: 15 * 60_000,
            lastActivity: 1,
        });

        const response = await handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs: 15 * 60_000, activity: true },
        });

        expect(response.ok).toBe(false);
        expect(await sessionBackend.load()).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('wires the refusal callback and reason into the desktop Locked screen', () => {
        const source = readFileSync(
            new URL('../../../../packages/desktop/renderer/App.jsx', import.meta.url),
            'utf8',
        );
        expect(source).toContain('onArmRefused: noteAutoLockUnsaved');
        expect(source).toContain('lockReason={lockReason}');
        expect(source).toContain("setLockReason('auto-lock-unsaved')");
    });
});
