// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BiometricNotRegisteredError,
    BiometricPrfUnavailableError,
    BiometricUnsupportedError,
    biometricProviderName,
    clearBiometricCredential,
    describeBiometric,
    isBiometricRegistered,
    isBiometricSupported,
    registerBiometricCredential,
    retireBiometricAfterPasswordChange,
    setBiometricProvider,
    unlockWithBiometric,
} from '../../../packages/core/src/flows/biometricUnlock.js';

const STORAGE_KEY = 'xchain-wallet:biometric';
const originalCredentials = Object.getOwnPropertyDescriptor(globalThis.navigator, 'credentials');
const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(
    globalThis,
    'PublicKeyCredential',
);

function provider(overrides = {}) {
    return {
        name: 'test-provider',
        isSupported: vi.fn(async () => true),
        isRegistered: vi.fn(() => true),
        register: vi.fn(async () => {}),
        unlock: vi.fn(async () => 'secret'),
        clear: vi.fn(async () => {}),
        ...overrides,
    };
}

function setCredentials(credentials) {
    Object.defineProperty(globalThis.navigator, 'credentials', {
        configurable: true,
        value: credentials,
    });
}

function installWebAuthn({ available = true, create, get } = {}) {
    setCredentials({
        create: create || vi.fn(),
        get: get || vi.fn(),
    });
    Object.defineProperty(globalThis, 'PublicKeyCredential', {
        configurable: true,
        value: {
            isUserVerifyingPlatformAuthenticatorAvailable: vi.fn(async () => available),
        },
    });
}

function credentialWithPrf(prf, rawId = new Uint8Array([1, 2, 3])) {
    return {
        rawId: rawId.buffer,
        getClientExtensionResults: () => ({
            prf: { results: { first: prf.buffer } },
        }),
    };
}

afterEach(() => {
    setBiometricProvider(null);
    globalThis.localStorage.clear();
    if (originalCredentials) {
        Object.defineProperty(globalThis.navigator, 'credentials', originalCredentials);
    } else {
        delete globalThis.navigator.credentials;
    }
    if (originalPublicKeyCredential) {
        Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKeyCredential);
    } else {
        delete globalThis.PublicKeyCredential;
    }
});

describe('default WebAuthn provider branches', () => {
    it('registers, unlocks, and clears a PRF credential', async () => {
        const prf = new Uint8Array(32).fill(7);
        const create = vi.fn(async () => credentialWithPrf(prf));
        const get = vi.fn(async () => credentialWithPrf(prf));
        installWebAuthn({ create, get });

        await registerBiometricCredential({ password: 'wallet-password' });
        expect(isBiometricRegistered()).toBe(true);
        await expect(unlockWithBiometric()).resolves.toBe('wallet-password');
        expect(create.mock.calls[0][0].publicKey.user.name).toBe('XChain Wallet');
        expect(get).toHaveBeenCalledOnce();

        clearBiometricCredential();
        expect(isBiometricRegistered()).toBe(false);
    });

    it('obtains PRF output from an assertion when creation omits it', async () => {
        const prf = new Uint8Array(32).fill(9);
        const create = vi.fn(async () => ({
            rawId: new Uint8Array([4, 5]).buffer,
        }));
        const get = vi.fn(async () => credentialWithPrf(prf));
        installWebAuthn({ create, get });

        await registerBiometricCredential({ password: 'secret', accountName: 'Savings' });
        expect(create.mock.calls[0][0].publicKey.user.name).toBe('Savings');
        expect(get).toHaveBeenCalledOnce();
    });

    it('validates passwords, support, and credential creation', async () => {
        installWebAuthn();
        await expect(registerBiometricCredential({ password: '' }))
            .rejects.toThrow('password is required');

        installWebAuthn({ available: false });
        await expect(registerBiometricCredential({ password: 'secret' }))
            .rejects.toBeInstanceOf(BiometricUnsupportedError);

        installWebAuthn({ create: vi.fn(async () => null) });
        await expect(registerBiometricCredential({ password: 'secret' }))
            .rejects.toBeInstanceOf(BiometricUnsupportedError);
    });

    it('reports missing PRF results from registration and unlock', async () => {
        installWebAuthn({
            create: vi.fn(async () => ({ rawId: new Uint8Array([1]).buffer })),
            get: vi.fn(async () => null),
        });
        await expect(registerBiometricCredential({ password: 'secret' }))
            .rejects.toBeInstanceOf(BiometricPrfUnavailableError);

        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            credentialId: 'AQ==',
            prfSalt: 'Ag==',
            ciphertext: 'Aw==',
            createdAt: 1,
        }));
        await expect(unlockWithBiometric()).rejects.toBeInstanceOf(BiometricPrfUnavailableError);
    });

    it('reports absent registration before probing support', async () => {
        const probe = vi.fn(async () => true);
        installWebAuthn();
        globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = probe;
        await expect(unlockWithBiometric()).rejects.toBeInstanceOf(BiometricNotRegisteredError);
        expect(probe).not.toHaveBeenCalled();
    });

    it('rejects malformed stored records', () => {
        for (const value of [
            '{',
            'null',
            JSON.stringify({ credentialId: '', prfSalt: 'salt', ciphertext: 'cipher' }),
            JSON.stringify({ credentialId: 'id', prfSalt: '', ciphertext: 'cipher' }),
            JSON.stringify({ credentialId: 'id', prfSalt: 'salt', ciphertext: '' }),
        ]) {
            globalThis.localStorage.setItem(STORAGE_KEY, value);
            expect(isBiometricRegistered()).toBe(false);
        }
    });

    it('contains platform-authenticator probe rejection', async () => {
        installWebAuthn();
        globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(
            async () => { throw new Error('probe failed'); },
        );
        await expect(describeBiometric()).resolves.toMatchObject({
            supported: false,
            reason: expect.stringMatching(/couldn't check/i),
        });
    });
});

describe('biometric provider seam branches', () => {
    it.each(['isSupported', 'isRegistered', 'register', 'unlock', 'clear'])
        ('rejects a provider missing %s', (method) => {
            const candidate = provider();
            delete candidate[method];
            expect(() => setBiometricProvider(candidate)).toThrow(`missing ${method}()`);
        });

    it('reports provider descriptions and overrides the mechanism from the probe', async () => {
        setBiometricProvider(provider({
            mechanism: 'fingerprint',
            wrapNote: 'hardware wrapped',
            describe: vi.fn(async () => ({
                supported: false,
                reason: 'enroll a finger',
                mechanism: 'face scan',
            })),
        }));

        expect(biometricProviderName()).toBe('test-provider');
        await expect(describeBiometric()).resolves.toEqual({
            provider: 'test-provider',
            supported: false,
            reason: 'enroll a finger',
            mechanism: 'face scan',
            wrapNote: 'hardware wrapped',
        });
    });

    it('ignores malformed optional description fields', async () => {
        setBiometricProvider(provider({
            mechanism: '',
            wrapNote: '',
            describe: vi.fn(async () => ({ supported: true, reason: 7, mechanism: '' })),
        }));
        await expect(describeBiometric()).resolves.toMatchObject({
            supported: true,
            reason: null,
            mechanism: 'your device biometric',
            wrapNote: 'Your password is encrypted and is never stored in plain text.',
        });
    });

    it('contains synchronous and asynchronous support probe failures', async () => {
        setBiometricProvider(provider({ isSupported: () => { throw new Error('sync'); } }));
        await expect(isBiometricSupported()).resolves.toBe(false);
        setBiometricProvider(provider({ isSupported: async () => { throw new Error('async'); } }));
        await expect(isBiometricSupported()).resolves.toBe(false);
    });

    it('contains registration probe failures', () => {
        setBiometricProvider(provider({ isRegistered: () => { throw new Error('probe'); } }));
        expect(isBiometricRegistered()).toBe(false);
    });

    it('delegates registration, unlock, and clearing', async () => {
        const active = provider();
        setBiometricProvider(active);
        const input = { password: 'secret', accountName: 'Account' };
        await registerBiometricCredential(input);
        await expect(unlockWithBiometric()).resolves.toBe('secret');
        await clearBiometricCredential();
        expect(active.register).toHaveBeenCalledWith(input);
        expect(active.unlock).toHaveBeenCalledOnce();
        expect(active.clear).toHaveBeenCalledOnce();
    });

    it('keeps enrollment for wallet-only changes and absent credentials', async () => {
        const active = provider();
        setBiometricProvider(active);
        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: false })).resolves.toBe(false);
        expect(active.clear).not.toHaveBeenCalled();

        active.isRegistered.mockReturnValue(false);
        await expect(retireBiometricAfterPasswordChange()).resolves.toBe(false);
        expect(active.clear).not.toHaveBeenCalled();
    });
});
