// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    BiometricNotRegisteredError,
    BiometricUnsupportedError,
} from '../../../packages/core/src/flows/biometricUnlock.js';
import {
    nativeBiometricProvider,
    refreshBiometricEnrollment,
} from '../../../packages/web/src/storage/nativeBiometricProvider.js';
import {
    startNativeQrScan,
} from '../../../packages/web/src/storage/nativeQrScanner.js';
import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';

function biometricPlugin(overrides = {}) {
    return {
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricStatus: vi.fn(async () => ({
            status: 'OK',
            available: true,
            enrolled: false,
            mechanism: '',
        })),
        biometricEnroll: vi.fn(async () => ({ status: 'OK' })),
        biometricUnlock: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricClear: vi.fn(async () => ({ status: 'OK' })),
        ...overrides,
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
    __setNativeVaultForTests(null);
    await refreshBiometricEnrollment();
    __setNativeVaultForTests(undefined);
});

describe('native biometric provider edges', () => {
    it('reports unsupported directly when no native vault exists', async () => {
        __setNativeVaultForTests(null);
        await expect(nativeBiometricProvider.describe()).resolves.toEqual({ supported: false });
        await expect(nativeBiometricProvider.isSupported()).resolves.toBe(false);
    });

    it('omits an empty mechanism from a successful description', async () => {
        __setNativeVaultForTests(biometricPlugin());
        await expect(nativeBiometricProvider.describe()).resolves.toEqual({
            supported: true,
            mechanism: undefined,
        });
    });

    it('rejects non-string registration secrets before touching native code', async () => {
        const native = biometricPlugin();
        __setNativeVaultForTests(native);

        await expect(nativeBiometricProvider.register({ password: new Uint8Array([1]) }))
            .rejects.toThrow(/password is required/);
        expect(native.biometricEnroll).not.toHaveBeenCalled();
    });

    it('gives an actionable error after repeated biometric failures', async () => {
        const native = biometricPlugin({
            biometricStatus: vi.fn(async () => ({ status: 'OK', available: true, enrolled: true })),
            biometricUnlock: vi.fn(async () => ({
                status: 'LOCKED',
                detail: 'biometric authentication failed repeatedly',
            })),
        });
        __setNativeVaultForTests(native);
        await refreshBiometricEnrollment();

        await expect(nativeBiometricProvider.unlock()).rejects.toThrow(
            /did not recognize you after several attempts/i,
        );
    });

    it('accepts an already-absent clear and rejects any unknown clear status', async () => {
        __setNativeVaultForTests(biometricPlugin({
            biometricClear: vi.fn(async () => ({ status: 'ABSENT' })),
        }));
        await expect(nativeBiometricProvider.clear()).resolves.toBeUndefined();

        __setNativeVaultForTests(biometricPlugin({
            biometricClear: vi.fn(async () => ({ status: 'MAYBE' })),
        }));
        await expect(nativeBiometricProvider.clear()).rejects.toThrow(
            'biometricUnlock: native clear failed',
        );
    });

    it('clears the cached enrollment without a plugin', async () => {
        __setNativeVaultForTests(biometricPlugin({
            biometricStatus: vi.fn(async () => ({ status: 'OK', available: true, enrolled: true })),
        }));
        await refreshBiometricEnrollment();
        expect(nativeBiometricProvider.isRegistered()).toBe(true);

        __setNativeVaultForTests(null);
        await nativeBiometricProvider.clear();
        expect(nativeBiometricProvider.isRegistered()).toBe(false);
        await expect(nativeBiometricProvider.unlock()).rejects.toThrow(BiometricNotRegisteredError);
    });

    it('keeps unknown unlock failures typed as unsupported', async () => {
        __setNativeVaultForTests(biometricPlugin({
            biometricStatus: vi.fn(async () => ({ status: 'OK', available: true, enrolled: true })),
            biometricUnlock: vi.fn(async () => ({ status: 'LOCKED', detail: 'sensor failed' })),
        }));
        await refreshBiometricEnrollment();

        await expect(nativeBiometricProvider.unlock()).rejects.toThrow(BiometricUnsupportedError);
    });
});

describe('native QR provider cleanup edges', () => {
    it('detaches an earlier listener when later listener registration throws', async () => {
        const remove = vi.fn(async () => {});
        const addListener = vi.fn()
            .mockReturnValueOnce({ remove })
            .mockImplementationOnce(() => { throw new Error('listener unavailable'); });
        __setNativeVaultForTests({
            loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
            qrScanStart: vi.fn(async () => ({})),
            addListener,
        });

        await expect(startNativeQrScan(() => {}, () => {}))
            .rejects.toMatchObject({ reason: 'unavailable' });
        await settle();
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('contains rejected listener removal and stop calls', async () => {
        const remove = vi.fn(async () => { throw new Error('already removed'); });
        const qrScanStop = vi.fn(async () => { throw new Error('already stopped'); });
        __setNativeVaultForTests({
            loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
            qrScanStart: vi.fn(async () => ({})),
            qrScanStop,
            addListener: vi.fn(() => Promise.resolve({ remove })),
        });

        const stop = await startNativeQrScan(() => {}, () => {});
        expect(() => stop()).not.toThrow();
        await settle();
        expect(remove).toHaveBeenCalledTimes(2);
        expect(qrScanStop).toHaveBeenCalledTimes(1);
    });

    it('ignores a duplicate native close event', async () => {
        const listeners = new Map();
        __setNativeVaultForTests({
            loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
            qrScanStart: vi.fn(async () => ({})),
            addListener: vi.fn((event, listener) => {
                listeners.set(event, listener);
                return { remove: vi.fn() };
            }),
        });
        const onClosed = vi.fn();
        await startNativeQrScan(() => {}, onClosed);

        listeners.get('qrScanClosed')({ reason: 'cancelled' });
        listeners.get('qrScanClosed')({ reason: 'interrupted' });
        expect(onClosed).toHaveBeenCalledTimes(1);
    });
});
