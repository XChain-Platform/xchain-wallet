/**
 * @vitest-environment node
 */

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A lock that lands while a password change is committing its caches must
// leave nothing in session storage: neither the new vault key nor the new
// password may be written back behind the lock.

import { describe, expect, it, vi } from 'vitest';

import { createVaultKeyring } from '../../../packages/extension/src/background/vaultKeyring.js';
import { ChromeSessionBackend } from '../../../packages/extension/src/storage/ChromeSessionBackend.js';

const OLD_KEY = Uint8Array.of(1, 1, 1, 1);
const NEW_KEY = Uint8Array.of(2, 2, 2, 2);
const SIGNING_KEY = 'signing-slot';
const SESSION_KEY = 'session-slot';

function memoryStorage() {
    const values = {};
    return {
        values,
        get: vi.fn(async (key) => (key in values ? { [key]: values[key] } : {})),
        set: vi.fn(async (items) => { Object.assign(values, items); }),
        remove: vi.fn(async (key) => { delete values[key]; }),
    };
}

async function unlockedSession() {
    const storage = memoryStorage();
    const session = new ChromeSessionBackend({ key: SESSION_KEY, chromeStorage: storage });
    const signing = new ChromeSessionBackend({ key: SIGNING_KEY, chromeStorage: storage });
    await session.save(OLD_KEY);
    await signing.save(new TextEncoder().encode('old-password'));
    // The same two clears, in the same order, that wallet.lock performs.
    const lock = async () => {
        await session.clear();
        await signing.clear();
    };
    return { storage, session, signing, lock };
}

const commitArgs = () => ({
    masterKey: new Uint8Array(NEW_KEY),
    password: 'new-password',
    previousKey: new Uint8Array(OLD_KEY),
});

describe('vaultKeyring.commit against a concurrent lock', () => {
    it('moves the session key and the signing password when nothing locks', async () => {
        const { storage, session, signing } = await unlockedSession();
        const keyring = createVaultKeyring({
            metaBackend: { load: async () => null }, sessionBackend: session, signingSecretBackend: signing,
        });

        await expect(keyring.commit(commitArgs())).resolves.toBe(true);

        await expect(session.load()).resolves.toEqual(NEW_KEY);
        expect(new TextDecoder().decode(await signing.load())).toBe('new-password');
        expect(Object.keys(storage.values).sort()).toEqual([SESSION_KEY, SIGNING_KEY]);
    });

    it('writes nothing when the lock lands between the key check and the key write', async () => {
        const { storage, session, signing, lock } = await unlockedSession();
        const racing = {
            load: async () => {
                const seen = await session.load();
                await lock();
                return seen;
            },
            save: (key, options) => session.save(key, options),
            clear: () => session.clear(),
        };
        const keyring = createVaultKeyring({
            metaBackend: { load: async () => null }, sessionBackend: racing, signingSecretBackend: signing,
        });

        await expect(keyring.commit(commitArgs())).resolves.toBe(false);

        expect(storage.values).toEqual({});
    });

    it('takes back the password when the lock lands between the key write and the password write', async () => {
        const { storage, session, signing, lock } = await unlockedSession();
        const racing = {
            save: async (blob) => {
                await lock();
                return signing.save(blob);
            },
            clear: () => signing.clear(),
        };
        const keyring = createVaultKeyring({
            metaBackend: { load: async () => null }, sessionBackend: session, signingSecretBackend: racing,
        });

        await expect(keyring.commit(commitArgs())).resolves.toBe(false);

        expect(storage.values).toEqual({});
    });

});

describe('vaultKeyring.commit slot ownership', () => {
    it('leaves a different live session key alone', async () => {
        const { session, signing } = await unlockedSession();
        const other = Uint8Array.of(9, 9, 9, 9);
        const racing = {
            save: async (blob) => {
                await session.save(other);
                return signing.save(blob);
            },
            clear: () => signing.clear(),
        };
        const keyring = createVaultKeyring({
            metaBackend: { load: async () => null }, sessionBackend: session, signingSecretBackend: racing,
        });

        await expect(keyring.commit(commitArgs())).resolves.toBe(true);

        await expect(session.load()).resolves.toEqual(other);
    });

    it('rethrows a storage failure that is not a conflict', async () => {
        const failing = {
            load: async () => new Uint8Array(OLD_KEY),
            save: async () => { throw new Error('quota'); },
            clear: async () => {},
        };
        const keyring = createVaultKeyring({ metaBackend: { load: async () => null }, sessionBackend: failing });

        await expect(keyring.commit(commitArgs())).rejects.toThrow('quota');
    });
});
