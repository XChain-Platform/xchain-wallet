// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The biometric seal wraps the wallet password itself, so its wrap key, the
// PRF output the key is cut from and the password bytes are zeroed on every
// exit, a refused seal and a failed tag check included.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ encryptKey: null, sealed: null, decryptKey: null, opened: null, failSeal: false }));

vi.mock('../../../packages/core/src/crypto/aead.js', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        encrypt: vi.fn(async (key, plaintext, aad) => {
            seen.encryptKey = key;
            seen.sealed = plaintext;
            if (seen.failSeal) throw new Error('seal refused');
            return real.encrypt(key, plaintext, aad);
        }),
        decrypt: vi.fn(async (key, blob, aad) => {
            seen.decryptKey = key;
            seen.opened = await real.decrypt(key, blob, aad);
            return seen.opened;
        }),
    };
});

import {
    registerBiometricCredential,
    unlockWithBiometric,
} from '../../../packages/core/src/flows/biometricUnlock.js';

const STORAGE_KEY = 'xchain-wallet:biometric';
const PRF = new Uint8Array(32).fill(5);
const originalCredentials = Object.getOwnPropertyDescriptor(globalThis.navigator, 'credentials');
const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');

/** @type {Uint8Array[]} */
let handed = [];

// Record each PRF buffer the fake authenticator hands out, so a test can read it afterwards.
function credential() {
    return {
        rawId: new Uint8Array([1, 2, 3]).buffer,
        getClientExtensionResults: () => {
            const first = PRF.slice();
            handed.push(first);
            return { prf: { results: { first: first.buffer } } };
        },
    };
}

const allZero = (bytes) => bytes.every((b) => b === 0);

beforeEach(() => {
    handed = [];
    Object.assign(seen, { encryptKey: null, sealed: null, decryptKey: null, opened: null, failSeal: false });
    Object.defineProperty(globalThis.navigator, 'credentials', {
        configurable: true,
        value: { create: vi.fn(async () => credential()), get: vi.fn(async () => credential()) },
    });
    Object.defineProperty(globalThis, 'PublicKeyCredential', {
        configurable: true,
        value: { isUserVerifyingPlatformAuthenticatorAvailable: vi.fn(async () => true) },
    });
});

afterEach(() => {
    globalThis.localStorage.clear();
    if (originalCredentials) Object.defineProperty(globalThis.navigator, 'credentials', originalCredentials);
    else delete globalThis.navigator.credentials;
    if (originalPublicKeyCredential) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKeyCredential);
    else delete globalThis.PublicKeyCredential;
});

describe('biometric seal zeroes its secrets', () => {
    it('zeroes the wrap key, the PRF output and the password bytes after registering', async () => {
        await registerBiometricCredential({ password: 'wallet-password' });
        expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
        expect(seen.encryptKey).toHaveLength(32);
        expect(allZero(seen.encryptKey)).toBe(true);
        expect(seen.sealed.length).toBeGreaterThan(0);
        expect(allZero(seen.sealed)).toBe(true);
        expect(handed).toHaveLength(1);
        expect(allZero(handed[0])).toBe(true);
    });

    it('zeroes the same secrets when the seal itself throws', async () => {
        seen.failSeal = true;
        await expect(registerBiometricCredential({ password: 'wallet-password' }))
            .rejects.toThrow('seal refused');
        expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(allZero(seen.encryptKey)).toBe(true);
        expect(allZero(seen.sealed)).toBe(true);
        expect(allZero(handed[0])).toBe(true);
    });

    it('returns the password and zeroes the key, PRF output and plaintext after unlocking', async () => {
        await registerBiometricCredential({ password: 'wallet-password' });
        await expect(unlockWithBiometric()).resolves.toBe('wallet-password');
        expect(allZero(seen.decryptKey)).toBe(true);
        expect(seen.opened.length).toBeGreaterThan(0);
        expect(allZero(seen.opened)).toBe(true);
        expect(handed).toHaveLength(2);
        expect(allZero(handed[1])).toBe(true);
    });

    it('zeroes the key and PRF output when the tag check fails', async () => {
        await registerBiometricCredential({ password: 'wallet-password' });
        const record = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
        const sealed = Uint8Array.from(atob(record.ciphertext), (c) => c.charCodeAt(0));
        sealed[sealed.length - 1] ^= 0xff;
        record.ciphertext = btoa(String.fromCharCode(...sealed));
        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));

        await expect(unlockWithBiometric()).rejects.toMatchObject({ name: 'AeadAuthError' });
        expect(allZero(seen.decryptKey)).toBe(true);
        expect(allZero(handed[1])).toBe(true);
    });
});
