// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native biometric provider + the core provider seam (S2).
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
    retireBiometricAfterPasswordChange,
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

    it('refreshes enrollment while probing current availability', async () => {
        const plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });
        expect(isBiometricRegistered()).toBe(true);

        plugin.state.wrap = null;
        expect(await isBiometricSupported()).toBe(true);
        expect(isBiometricRegistered()).toBe(false);
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
            biometricEnroll: async () => ({ status: PASSWORD, detail: PASSWORD }),
        }));
        await installNativeBiometricProvider();
        const error = await registerBiometricCredential({ password: PASSWORD }).catch((err) => err);
        expect(error).toBeInstanceOf(BiometricUnsupportedError);
        expect(error.message).toMatch(/native enrollment refused/);
        expect(error.message).not.toContain(PASSWORD);
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

    it('discards a wrap the native side reports invalidated', async () => {
        // iOS answers ABSENT for a Keychain item a biometric re-enrolment
        // invalidated, but the item stays stored with the enrolment-day
        // password in it. Only an explicit clear removes it, and a later
        // password change does not reach it because the cached flag is false.
        const plugin = fakeVault({
            biometricUnlock: vi.fn(async () => ({
                status: 'ABSENT',
                detail: 'no biometric wrap is stored, or it was invalidated',
            })),
        });
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });

        await expect(unlockWithBiometric()).rejects.toThrow(BiometricNotRegisteredError);
        expect(plugin.biometricClear).toHaveBeenCalledOnce();
        expect(plugin.state.wrap).toBeNull();
        expect(isBiometricRegistered()).toBe(false);
    });

    it('falls back to the password when discarding an invalidated wrap fails', async () => {
        const plugin = fakeVault({
            biometricUnlock: vi.fn(async () => ({ status: 'ABSENT', detail: 'invalidated' })),
            biometricClear: vi.fn(async () => { throw new Error('keychain busy'); }),
        });
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });

        await expect(unlockWithBiometric()).rejects.toThrow(BiometricNotRegisteredError);
        expect(plugin.biometricClear).toHaveBeenCalledOnce();
        expect(isBiometricRegistered()).toBe(false);
    });

    it('surfaces a failed prompt without reflecting native detail', async () => {
        const plugin = fakeVault({
            biometricUnlock: async () => ({ status: PASSWORD, detail: PASSWORD }),
        });
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });
        const error = await unlockWithBiometric().catch((err) => err);
        expect(error).toBeInstanceOf(BiometricUnsupportedError);
        expect(error.message).toMatch(/biometric unlock failed/);
        expect(error.message).not.toContain(PASSWORD);
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
    it('drops the affordance after the native side confirms deletion', async () => {
        const plugin = fakeVault();
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });

        await clearBiometricCredential();
        expect(isBiometricRegistered()).toBe(false);
        expect(plugin.biometricClear).toHaveBeenCalled();
    });

    it('keeps the affordance enabled when the native clear fails', async () => {
        __setNativeVaultForTests(fakeVault({
            biometricClear: async () => { throw new Error('keystore busy'); },
        }));
        await installNativeBiometricProvider();
        await registerBiometricCredential({ password: PASSWORD });

        await expect(clearBiometricCredential()).rejects.toThrow(/XChainVault\.biometricClear failed/);
        expect(isBiometricRegistered()).toBe(true);
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

describe('password change with an unknown enrolment state', () => {
    // A wrap stored on the device while the startup status probe failed: the
    // cached flag reads false, yet the wrap still holds the old password.
    function wrapBehindAFailedProbe(failures) {
        const plugin = fakeVault();
        plugin.state.wrap = 'b2xkIHBhc3N3b3Jk';
        let calls = 0;
        plugin.biometricStatus = vi.fn(async () => {
            calls += 1;
            if (calls <= failures) throw new Error('bridge not ready');
            return { status: 'OK', available: true, enrolled: plugin.state.wrap !== null };
        });
        return plugin;
    }

    it('clears a wrap the startup probe missed', async () => {
        const plugin = wrapBehindAFailedProbe(1);
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();
        expect(isBiometricRegistered()).toBe(false);

        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).resolves.toBe(true);
        expect(plugin.biometricClear).toHaveBeenCalledTimes(1);
        expect(plugin.state.wrap).toBeNull();
    });

    it('clears when the device still cannot say whether a wrap exists', async () => {
        const plugin = wrapBehindAFailedProbe(Infinity);
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();

        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).resolves.toBe(true);
        expect(plugin.biometricClear).toHaveBeenCalledTimes(1);
        expect(plugin.state.wrap).toBeNull();
    });

    it('clears when the status reply carries no enrolled flag', async () => {
        const plugin = fakeVault({ biometricStatus: vi.fn(async () => ({ status: 'OK', available: true })) });
        plugin.state.wrap = 'b2xkIHBhc3N3b3Jk';
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();

        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).resolves.toBe(true);
        expect(plugin.biometricClear).toHaveBeenCalledTimes(1);
    });

    it('skips the clear once the device confirms there is no wrap', async () => {
        const plugin = wrapBehindAFailedProbe(1);
        plugin.state.wrap = null;
        __setNativeVaultForTests(plugin);
        await installNativeBiometricProvider();

        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).resolves.toBe(false);
        expect(plugin.biometricClear).not.toHaveBeenCalled();
    });
});
