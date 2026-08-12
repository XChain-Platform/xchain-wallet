// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `describeBiometric()` and the provider self-description contract.
//
// The defect these cover: the shared settings row hardcoded "Touch ID /
// Windows Hello" and explained unavailability in terms of WebAuthn and PRF,
// so on Android it named two foreign vendors and gave a browser-API reason
// for a condition whose real cause ("no fingerprint enrolled") the native
// provider already knew and the row discarded.
//
// Hence the shape of these tests: what a user reads must come from the
// provider that actually knows, a provider that knows nothing must still
// produce correct generic copy, and a raw native developer string must never
// reach the surface.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    describeBiometric,
    setBiometricProvider,
    BIOMETRIC_GENERIC_MECHANISM,
    BIOMETRIC_GENERIC_UNAVAILABLE,
    BIOMETRIC_GENERIC_WRAP_NOTE,
} from '../../../packages/core/src/flows/biometricUnlock.js';
import {
    nativeBiometricProvider,
} from '../../../packages/web/src/storage/nativeBiometricProvider.js';
import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';

/** Words that must never appear in copy composed for a native shell. */
const FOREIGN_VOCABULARY = [/Touch ID/i, /Windows Hello/i, /WebAuthn/i, /\bPRF\b/];

function minimalProvider(overrides = {}) {
    return {
        name: 'minimal',
        isSupported: async () => false,
        isRegistered: () => false,
        register: async () => {},
        unlock: async () => '',
        clear: () => {},
        ...overrides,
    };
}

function nativeVault(status) {
    return {
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricStatus: vi.fn(async () => status),
        biometricEnroll: vi.fn(async () => ({ status: 'OK' })),
        biometricUnlock: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricClear: vi.fn(async () => ({ status: 'OK' })),
    };
}

afterEach(() => {
    setBiometricProvider(null);
    __setNativeVaultForTests(undefined);
});

describe('generic fallbacks', () => {
    it('fills in every field for a provider that describes nothing', async () => {
        setBiometricProvider(minimalProvider());
        const described = await describeBiometric();
        expect(described.supported).toBe(false);
        expect(described.reason).toBe(BIOMETRIC_GENERIC_UNAVAILABLE);
        expect(described.mechanism).toBe(BIOMETRIC_GENERIC_MECHANISM);
        expect(described.wrapNote).toBe(BIOMETRIC_GENERIC_WRAP_NOTE);
        expect(described.provider).toBe('minimal');
    });

    it('never leaves a supported provider without a mechanism to name', async () => {
        setBiometricProvider(minimalProvider({ isSupported: async () => true }));
        const described = await describeBiometric();
        expect(described.supported).toBe(true);
        // Supported means there is nothing to explain: a reason shown beside a
        // working affordance reads as a warning about it.
        expect(described.reason).toBeNull();
        expect(described.mechanism.length).toBeGreaterThan(0);
    });

    it('survives a provider that throws, because this runs inside a render effect', async () => {
        setBiometricProvider(minimalProvider({
            describe: async () => { throw new Error('binder died'); },
        }));
        const described = await describeBiometric();
        expect(described.supported).toBe(false);
        expect(described.reason).toBe(BIOMETRIC_GENERIC_UNAVAILABLE);
        // The thrown message is a developer string and must not surface.
        expect(described.reason).not.toMatch(/binder/);
    });
});

describe('the WebAuthn provider owns its own vocabulary', () => {
    it('names the browser mechanisms, and only it does', async () => {
        const described = await describeBiometric();
        expect(described.provider).toBe('webauthn-prf');
        expect(described.mechanism).toMatch(/Touch ID/);
        expect(described.mechanism).toMatch(/Windows Hello/);
    });

    it('separates "this browser cannot" from "you have not set one up"', async () => {
        const savedPkc = globalThis.PublicKeyCredential;
        const savedCreds = globalThis.navigator?.credentials;
        const setCredentials = (value) => {
            Object.defineProperty(globalThis.navigator, 'credentials', {
                value, configurable: true, writable: true,
            });
        };
        try {
            delete globalThis.PublicKeyCredential;
            const missing = await describeBiometric();
            expect(missing.supported).toBe(false);
            expect(missing.reason).toMatch(/browser does not support/i);

            // Now the API exists but the device has nothing enrolled for it,
            // which asks something entirely different of the user.
            setCredentials({ create: () => {}, get: () => {} });
            globalThis.PublicKeyCredential = {
                isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
            };
            const none = await describeBiometric();
            expect(none.supported).toBe(false);
            expect(none.reason).toMatch(/no built-in fingerprint, face, or PIN/i);
            expect(none.reason).not.toBe(missing.reason);

            // And when one IS available there is nothing to explain at all.
            globalThis.PublicKeyCredential = {
                isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
            };
            const ok = await describeBiometric();
            expect(ok.supported).toBe(true);
            expect(ok.reason).toBeNull();
        } finally {
            if (savedPkc === undefined) delete globalThis.PublicKeyCredential;
            else globalThis.PublicKeyCredential = savedPkc;
            setCredentials(savedCreds);
        }
    });
});

describe('the native provider speaks for the device', () => {
    it('explains an empty enrollment in terms the user can act on', async () => {
        __setNativeVaultForTests(nativeVault({
            status: 'OK',
            available: false,
            enrolled: false,
            detail: 'no biometric enrolled',
            reasonCode: 'none_enrolled',
            mechanism: 'your fingerprint',
        }));
        setBiometricProvider(nativeBiometricProvider);

        const described = await describeBiometric();
        expect(described.supported).toBe(false);
        expect(described.reason).toMatch(/No fingerprint or face is set up/i);
        expect(described.reason).toMatch(/device security settings/i);
        for (const foreign of FOREIGN_VOCABULARY) {
            expect(described.reason).not.toMatch(foreign);
        }
    });

    it('reports the mechanism the device says it has', async () => {
        __setNativeVaultForTests(nativeVault({
            status: 'OK',
            available: true,
            enrolled: true,
            detail: 'ok',
            reasonCode: 'ok',
            mechanism: 'Face ID',
        }));
        setBiometricProvider(nativeBiometricProvider);

        const described = await describeBiometric();
        expect(described.supported).toBe(true);
        expect(described.mechanism).toBe('Face ID');
        for (const foreign of FOREIGN_VOCABULARY) {
            expect(described.wrapNote).not.toMatch(foreign);
        }
    });

    it('never surfaces the raw native detail, whatever the code', async () => {
        __setNativeVaultForTests(nativeVault({
            status: 'OK',
            available: false,
            enrolled: false,
            detail: 'unsupported (-2147483648)',
            reasonCode: 'a_code_this_build_does_not_know',
            mechanism: 'your fingerprint',
        }));
        setBiometricProvider(nativeBiometricProvider);

        const described = await describeBiometric();
        expect(described.reason).toBe(BIOMETRIC_GENERIC_UNAVAILABLE);
        expect(described.reason).not.toMatch(/2147483648/);
        // The mechanism is still usable even though the reason was not.
        expect(described.mechanism).toBe('your fingerprint');
    });

    it('falls back to generic copy against an older native build with no reasonCode', async () => {
        __setNativeVaultForTests(nativeVault({
            status: 'OK',
            available: false,
            enrolled: false,
            detail: 'no biometric enrolled',
        }));
        setBiometricProvider(nativeBiometricProvider);

        const described = await describeBiometric();
        expect(described.reason).toBe(BIOMETRIC_GENERIC_UNAVAILABLE);
        expect(described.mechanism).toBe(BIOMETRIC_GENERIC_MECHANISM);
    });

    it('invents no reason when the probe itself failed', async () => {
        __setNativeVaultForTests(nativeVault({}));
        const vault = nativeVault({});
        vault.biometricStatus = vi.fn(async () => { throw new Error('plugin gone'); });
        __setNativeVaultForTests(vault);
        setBiometricProvider(nativeBiometricProvider);

        const described = await describeBiometric();
        expect(described.supported).toBe(false);
        expect(described.reason).toBe(BIOMETRIC_GENERIC_UNAVAILABLE);
    });
});
