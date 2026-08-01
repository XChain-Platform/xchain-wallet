// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native biometric provider + the core provider seam ( S2).
//
// The seam exists so the SHARED unlock UI keeps working unchanged on a shell
// where WebAuthn does not exist. So the tests are mostly about the contract
// that UI depends on: probes never throw (they run inside a render effect on
// the lock screen), a real unlock attempt DOES throw so the user is told why,
// and an enrollment that has been invalidated stops advertising itself rather
// than offering a button that can only fail.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    isBiometricSupported,
    isBiometricRegistered,
    registerBiometricCredential,
    unlockWithBiometric,
    clearBiometricCredential,
    setBiometricProvider,
    biometricProviderName,
    BiometricNotRegisteredError,
    BiometricUnsupportedError,
} from '../../../packages/core/src/flows/biometricUnlock.js';
import {
    nativeBiometricProvider,
    installNativeBiometricProvider,
    refreshBiometricEnrollment,
} from '../../../packages/web/src/storage/nativeBiometricProvider.js';
import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';

const PASSWORD = 'correct horse battery staple';

function fakeVault(overrides = {}) {
    const state = { wrap: null, available: true };
    return {
        state,
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricStatus: vi.fn(async () => ({
            status: 'OK',
            available: state.available,
            enrolled: state.wrap !== null,
        })),
        biometricEnroll: vi.fn(async ({ secret }) => {
            state.wrap = secret;
            return { status: 'OK' };
        }),
        biometricUnlock: vi.fn(async () => (state.wrap === null
            ? { status: 'ABSENT', detail: 'no wrap' }
            : { status: 'OK', secret: state.wrap })),
        biometricClear: vi.fn(async () => { state.wrap = null; return { status: 'OK' }; }),
        ...overrides,
    };
}

afterEach(() => {
    setBiometricProvider(null);
    __setNativeVaultForTests(undefined);
});

describe('provider seam', () => {
    it('defaults to WebAuthn', () => {
        expect(biometricProviderName()).toBe('webauthn-prf');
    });

    it('refuses a provider missing part of the contract', () => {
        expect(() => setBiometricProvider({ isSupported: () => true }))
            .toThrow(/missing isRegistered/);
    });

    it('installs only on a native platform', async () => {
        __setNativeVaultForTests(null);
        expect(await installNativeBiometricProvider()).toBe(false);
        expect(biometricProviderName()).toBe('webauthn-prf');

        __setNativeVaultForTests(fakeVault());
        expect(await installNativeBiometricProvider()).toBe(true);
        expect(biometricProviderName()).toBe('native-biometric-prompt');
    });

    it('routes the shared UI calls to the installed provider', async () => {
        const plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();

        expect(await isBiometricSupported()).toBe(true);
        expect(plugin.biometricStatus).toHaveBeenCalled();
    });
});

describe('probes never throw', () => {
    it('reports unsupported when the provider itself blows up', async () => {
        // This runs inside a useEffect on the lock screen. A rejection here
        // would take the unlock screen down with it, locking the user out of
        // a wallet whose password they know perfectly well.
        setBiometricProvider({
            name: 'exploding',
            isSupported: () => { throw new Error('boom'); },
            isRegistered: () => { throw new Error('boom'); },
            register: async () => {},
            unlock: async () => 'x',
            clear: () => {},
        });
        expect(await isBiometricSupported()).toBe(false);
        expect(isBiometricRegistered()).toBe(false);
    });

    it('reports unsupported when the probe rejects asynchronously', async () => {
        setBiometricProvider({
            name: 'rejecting',
            isSupported: async () => { throw new Error('binder died'); },
            isRegistered: () => false,
            register: async () => {},
            unlock: async () => 'x',
            clear: () => {},
        });
        expect(await isBiometricSupported()).toBe(false);
    });

    it('answers false when the native status call fails', async () => {
        __setNativeVaultForTests(fakeVault({
            biometricStatus: async () => { throw new Error('no service'); },
        }));
        await installNativeBiometricProvider();
        expect(await isBiometricSupported()).toBe(false);
        expect(isBiometricRegistered()).toBe(false);
    });
});

describe('enroll / unlock round trip', () => {
    let plugin;
    beforeEach(async () => {
        plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
    });

    it('wraps the password and gives back exactly it', async () => {
        expect(isBiometricRegistered()).toBe(false);
        await registerBiometricCredential({ password: PASSWORD });
        expect(isBiometricRegistered()).toBe(true);
        expect(await unlockWithBiometric()).toBe(PASSWORD);
    });

    it('never puts the password on the bridge in the clear', async () => {
        await registerBiometricCredential({ password: PASSWORD });
        const sent = plugin.biometricEnroll.mock.calls[0][0].secret;
        expect(sent).not.toContain(PASSWORD);
        // base64 of the password, which is an encoding and not a disguise -
        // the point of the assertion is that the wire format is the agreed
        // one, so the native side can wrap the bytes it expects.
        expect(atob(sent)).toBe(PASSWORD);
    });

    it('round-trips a password with non-ASCII characters', async () => {
        const unicode = 'pässwörd-λ-🔑';
        await registerBiometricCredential({ password: unicode });
        expect(await unlockWithBiometric()).toBe(unicode);
    });

    it('refuses to enroll without a password', async () => {
        await expect(registerBiometricCredential({ password: '' }))
            .rejects.toThrow(/password is required/);
        expect(plugin.biometricEnroll).not.toHaveBeenCalled();
    });

    it('refuses to enroll when no Class 3 biometric is available', async () => {
        plugin.state.available = false;
        await expect(registerBiometricCredential({ password: PASSWORD }))
            .rejects.toThrow(BiometricUnsupportedError);
        expect(plugin.biometricEnroll).not.toHaveBeenCalled();
    });

    it('reports a refused enrollment rather than claiming success', async () => {
        __setNativeVaultForTests(fakeVault({
            biometricEnroll: async () => ({ status: 'LOCKED', detail: 'user cancelled' }),
        }));
        await installNativeBiometricProvider();
        await expect(registerBiometricCredential({ password: PASSWORD }))
            .rejects.toThrow(/user cancelled/);
        expect(isBiometricRegistered()).toBe(false);
    });
});

describe('unlock failures', () => {
    it('says not-registered when nothing is enrolled', async () => {
        __setNativeVaultForTests(fakeVault());
        await installNativeBiometricProvider();
        await expect(unlockWithBiometric()).rejects.toThrow(BiometricNotRegisteredError);
    });

    it('stops advertising itself once the wrap is gone', async () => {
        // Enrollment change or a removed lock screen invalidates the Keystore
        // key; the native side answers ABSENT. Leaving `isRegistered` true
        // would keep a button on the lock screen that can only ever fail.
        const plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });
        expect(isBiometricRegistered()).toBe(true);

        plugin.state.wrap = null;   // invalidated behind our back
        await expect(unlockWithBiometric()).rejects.toThrow(BiometricNotRegisteredError);
        expect(isBiometricRegistered()).toBe(false);
    });

    it('surfaces a cancelled or failed prompt', async () => {
        const plugin = fakeVault({
            biometricUnlock: async () => ({ status: 'LOCKED', detail: 'Authentication cancelled' }),
        });
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });
        await expect(unlockWithBiometric()).rejects.toThrow(/Authentication cancelled/);
    });

    it('refuses a success reply that carries no secret', async () => {
        const plugin = fakeVault({
            biometricUnlock: async () => ({ status: 'OK' }),
        });
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });
        await expect(unlockWithBiometric()).rejects.toThrow(/no secret/);
    });
});

describe('clear', () => {
    it('drops the affordance immediately and tells the native side', async () => {
        const plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });

        clearBiometricCredential();
        // Synchronous by contract: the shared settings row calls it without
        // awaiting and re-reads the flag on the next line.
        expect(isBiometricRegistered()).toBe(false);
        await Promise.resolve();
        expect(plugin.biometricClear).toHaveBeenCalled();
    });

    it('does not throw when the native clear fails', async () => {
        __setNativeVaultForTests(fakeVault({
            biometricClear: async () => { throw new Error('keystore busy'); },
        }));
        await installNativeBiometricProvider();
        expect(() => clearBiometricCredential()).not.toThrow();
        await Promise.resolve();
    });
});

describe('refreshBiometricEnrollment', () => {
    it('is false in a browser', async () => {
        __setNativeVaultForTests(null);
        expect(await refreshBiometricEnrollment()).toBe(false);
        expect(nativeBiometricProvider.isRegistered()).toBe(false);
    });

    it('re-reads the native state, so an out-of-band change is picked up', async () => {
        const plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        expect(await refreshBiometricEnrollment()).toBe(false);
        plugin.state.wrap = 'd2hhdGV2ZXI=';
        expect(await refreshBiometricEnrollment()).toBe(true);
    });
});
