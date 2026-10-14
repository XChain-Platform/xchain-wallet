/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
    AUTO_LOCK_REPORT_TYPE,
    createRuntime,
    enforceIdleAutoLock,
    enforceLaunchAutoLock,
    enforceSystemAutoLock,
    handleIpcMessage,
    tearDownHost,
    wipeRuntimeStores,
} from '../../../packages/desktop/main/runtime.js';

function backend(initial = null) {
    let value = initial;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        clear: vi.fn(async () => { value = null; }),
    };
}

function deps() {
    return {
        storageBackend: backend(),
        sessionBackend: backend(),
        metaBackend: backend(),
        chainRegistry: {},
        sdkRegistry: {},
    };
}

describe('desktop runtime construction branches', () => {
    it.each([
        ['storageBackend'],
        ['sessionBackend'],
        ['metaBackend'],
        ['chainRegistry'],
        ['sdkRegistry'],
    ])('requires %s', (name) => {
        const input = deps();
        delete input[name];
        expect(() => createRuntime(input)).toThrow(`${name} is required`);
    });

    it('rejects an absent dependency object and defaults optional adapters', () => {
        expect(() => createRuntime()).toThrow(/storageBackend is required/);
        const runtime = createRuntime(deps());
        expect(runtime.unlockThrottleStore).toBeNull();
        expect(runtime.autoLockStore).toBeNull();
        expect(runtime.onPrivacySettingsChanged).toBeNull();
        expect(runtime.notify).toBeNull();
    });
});

describe('desktop runtime teardown and wipe branches', () => {
    it('contains every watcher, signer, and vault teardown failure', () => {
        const runtime = createRuntime(deps());
        const failing = () => ({ stop: vi.fn(() => { throw new Error('stop failed'); }) });
        runtime.notificationService = failing();
        runtime.priceAlertWatcher = failing();
        runtime.governancePollWatcher = failing();
        runtime.deadlineWatcher = failing();
        runtime.dispenserEscrowWatcher = failing();
        runtime.coinpayAutopayWatcher = failing();
        const signerPool = { lockAll: vi.fn(() => { throw new Error('lock failed'); }) };
        const vault = { close: vi.fn(() => { throw new Error('close failed'); }) };
        runtime.signerPool = signerPool;
        runtime.vault = vault;
        runtime.host = {};

        expect(() => tearDownHost(runtime)).not.toThrow();

        expect(runtime.notificationService).toBeNull();
        expect(runtime.priceAlertWatcher).toBeNull();
        expect(runtime.governancePollWatcher).toBeNull();
        expect(runtime.deadlineWatcher).toBeNull();
        expect(runtime.dispenserEscrowWatcher).toBeNull();
        expect(runtime.coinpayAutopayWatcher).toBeNull();
        expect(runtime.signerPool).not.toBe(signerPool);
        expect(runtime.vault).toBeNull();
        expect(runtime.host).toBeNull();
    });

    it('requires a runtime and collects store failures without skipping later stores', async () => {
        await expect(wipeRuntimeStores()).rejects.toThrow(/runtime is required/);
        const input = deps();
        input.storageBackend.clear.mockRejectedValue(new Error('storage failed'));
        input.sessionBackend.clear.mockRejectedValue('session failed');
        const runtime = createRuntime({
            ...input,
            unlockThrottleStore: { clear: null },
            autoLockStore: { clear: vi.fn(async () => {}) },
        });

        await expect(wipeRuntimeStores(runtime)).resolves.toEqual({
            ok: false,
            cleared: ['meta', 'autoLock'],
            errors: [
                { store: 'storage', message: 'storage failed' },
                { store: 'session', message: 'session failed' },
            ],
        });
        expect(runtime.autoLockStore.clear).toHaveBeenCalledOnce();
    });
});

describe('desktop runtime dispatch branches', () => {
    it.each([undefined, null, 3, {}, { type: 4 }])('rejects an invalid message: %j', async (message) => {
        const result = await handleIpcMessage(createRuntime(deps()), message);
        expect(result.ok).toBe(false);
        expect(result.error.name).toBe('InvalidMessageError');
    });

    it('accepts auto-lock reports with and without a request when no store exists', async () => {
        const runtime = createRuntime(deps());
        await expect(handleIpcMessage(runtime, { type: AUTO_LOCK_REPORT_TYPE }))
            .resolves.toEqual({ ok: true, result: { armed: false } });
        await expect(handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs: 10 },
        })).resolves.toEqual({ ok: true, result: { armed: true } });
    });

    it('uses an existing host and serializes host failures', async () => {
        const runtime = createRuntime(deps());
        runtime.host = { handle: vi.fn(async () => ({ ok: true, result: 7 })) };
        await expect(handleIpcMessage(runtime, { type: 'custom.ok', request: {} }))
            .resolves.toEqual({ ok: true, result: 7 });
        runtime.host.handle.mockRejectedValue(new Error('host failed'));
        const failed = await handleIpcMessage(runtime, { type: 'custom.fail' });
        expect(failed.ok).toBe(false);
        expect(failed.error.message).toBe('host failed');
    });

    it('returns the locked envelope when no cached session exists', async () => {
        const result = await handleIpcMessage(createRuntime(deps()), { type: 'custom.locked' });
        expect(result.ok).toBe(false);
        expect(result.error.name).toBe('WalletLockedError');
    });
});

describe('desktop runtime auto-lock guard branches', () => {
    it('handles absent runtimes and stores', async () => {
        await expect(enforceIdleAutoLock(null)).resolves.toEqual({ locked: false, reason: 'no-runtime' });
        await expect(enforceSystemAutoLock(null)).resolves.toEqual({ locked: false, reason: 'no-runtime' });
        const runtime = createRuntime(deps());
        await expect(enforceLaunchAutoLock(runtime)).resolves.toEqual({ locked: false, reason: 'no-store' });
        await expect(enforceIdleAutoLock(runtime)).resolves.toEqual({ locked: false, reason: 'no-store' });
        await expect(enforceSystemAutoLock(runtime)).resolves.toEqual({ locked: false, reason: 'no-store' });
    });

    it('treats a session-backend read failure as no cached launch session', async () => {
        const input = deps();
        input.sessionBackend.load.mockRejectedValue(new Error('keychain unavailable'));
        const runtime = createRuntime({
            ...input,
            autoLockStore: { load: vi.fn(), clear: vi.fn() },
        });

        await expect(enforceLaunchAutoLock(runtime)).resolves.toEqual({
            locked: false,
            reason: 'no-session',
        });
        expect(runtime.autoLockStore.load).not.toHaveBeenCalled();
    });
});
