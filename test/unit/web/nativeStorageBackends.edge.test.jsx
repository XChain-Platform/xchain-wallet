// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { runInNewContext } from 'node:vm';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    __resetScreenGuardForTests,
    isScreenGuardActive,
    useProtectedScreen,
} from '../../../packages/core/src/shared/utils/screenGuard.js';
import {
    VaultLockedError,
    VaultUnavailableError,
} from '../../../packages/core/src/storage/backend.js';
import {
    CapacitorGuardBackend,
} from '../../../packages/web/src/storage/CapacitorStorageBackend.js';
import { WebMetaBackend } from '../../../packages/web/src/storage/WebMetaBackend.js';
import {
    __resetBackendCacheForTests,
    createMetaBackend,
    installNativeScreenGuard,
    installNativeWipeHook,
} from '../../../packages/web/src/storage/backends.js';
import {
    __setNativeShellForTests,
    __setNativeVaultForTests,
    encodePayload,
    isBytes,
} from '../../../packages/web/src/storage/nativeVault.js';
import {
    __resetPersistenceForTests,
    requestPersistentStorage,
} from '../../../packages/web/src/storage/storagePersistence.js';

const originalNavigator = globalThis.navigator;

function plugin(overrides = {}) {
    return {
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        loadGuards: vi.fn(async () => ({ status: 'ABSENT' })),
        saveGuards: vi.fn(async () => ({ status: 'OK' })),
        clearGuards: vi.fn(async () => ({ status: 'OK' })),
        clearVault: vi.fn(async () => ({ status: 'OK' })),
        clearMeta: vi.fn(async () => ({ status: 'OK' })),
        biometricClear: vi.fn(async () => ({ status: 'OK' })),
        setScreenProtected: vi.fn(async () => ({ status: 'OK' })),
        ...overrides,
    };
}

afterEach(() => {
    __setNativeVaultForTests(undefined);
    __setNativeShellForTests(undefined);
    __resetBackendCacheForTests();
    __resetScreenGuardForTests();
    __resetPersistenceForTests();
    delete globalThis.xchainWalletBridge;
    Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
    });
});

describe('native storage backend edges', () => {
    it('accepts Uint8Array values from another realm', () => {
        const bytes = runInNewContext('new Uint8Array([1, 2, 3])');

        expect(bytes instanceof Uint8Array).toBe(false);
        expect(isBytes(bytes)).toBe(true);
        expect(encodePayload(bytes)).toBe('AQID');
    });

    it('treats corrupt guards as absent but preserves typed read failures', async () => {
        __setNativeVaultForTests(plugin({
            loadGuards: vi.fn(async () => ({
                status: 'OK',
                blob: encodePayload(new TextEncoder().encode('{bad json')),
            })),
        }));
        await expect(new CapacitorGuardBackend().load()).resolves.toBeNull();

        __setNativeVaultForTests(plugin({
            loadGuards: vi.fn(async () => ({ status: 'LOCKED' })),
        }));
        await expect(new CapacitorGuardBackend().load()).rejects.toThrow(VaultLockedError);
    });

    it('requires guard writes and clears to receive an OK acknowledgement', async () => {
        __setNativeVaultForTests(plugin({
            saveGuards: vi.fn(async () => ({ status: 'LOCKED' })),
            clearGuards: vi.fn(async () => ({ status: 'MAYBE' })),
        }));
        const backend = new CapacitorGuardBackend();

        await expect(backend.save({ lockout: {} })).rejects.toThrow(VaultLockedError);
        await expect(backend.clear()).rejects.toThrow(VaultUnavailableError);
    });

    it('uses the web metadata backend in a browser', () => {
        __setNativeShellForTests(false);
        __setNativeVaultForTests(null);
        expect(createMetaBackend()).toBeInstanceOf(WebMetaBackend);
    });

    it('installs the native screen guard and contains rejected bridge calls', async () => {
        const native = plugin({
            setScreenProtected: vi.fn(async () => { throw new Error('bridge gone'); }),
        });
        __setNativeVaultForTests(native);

        expect(installNativeScreenGuard()).toBe(true);
        expect(isScreenGuardActive()).toBe(true);
        const { unmount } = renderHook(() => useProtectedScreen());
        unmount();
        await Promise.resolve();
        await Promise.resolve();

        expect(native.setScreenProtected).toHaveBeenNthCalledWith(1, { protected: true });
        expect(native.setScreenProtected).toHaveBeenNthCalledWith(2, { protected: false });
    });

    it('reports a non-Error wipe failure without throwing', async () => {
        __setNativeVaultForTests(plugin());
        installNativeWipeHook({ afterWipe: async () => { throw 'seal failed'; } });

        await expect(globalThis.xchainWalletBridge.wipeStorage()).resolves.toEqual({
            ok: false,
            error: 'seal failed',
        });
    });
});

describe('browser storage fallback edges', () => {
    it('requests persistence when persisted() is unavailable and coerces the reply', async () => {
        const persist = vi.fn(async () => 1);
        Object.defineProperty(globalThis, 'navigator', {
            value: { storage: { persist } },
            configurable: true,
            writable: true,
        });

        await expect(requestPersistentStorage()).resolves.toBe(true);
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('includes a thrown primitive in metadata write and clear failures', async () => {
        const backend = new WebMetaBackend({
            storage: {
                getItem: () => null,
                setItem: () => { throw 'write denied'; },
                removeItem: () => { throw 'clear denied'; },
            },
        });

        await expect(backend.save({})).rejects.toThrow(/write denied/);
        await expect(backend.clear()).rejects.toThrow(/clear denied/);
    });
});
