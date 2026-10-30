// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({ vaultOpenCalls: 0 }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            deriveMasterKey: () => new Uint8Array(32).fill(7),
        },
        storage: {
            ...actual.storage,
            Vault: class WrongPasswordVault {
                async open() {
                    mockState.vaultOpenCalls += 1;
                    throw new actual.crypto.AeadAuthError(new Error('invalid authentication tag'));
                }

                close() { /* no key material in this test double */ }
            },
        },
    };
});

const { handleWalletUnlock } = await import(
    '../../../packages/extension/src/background/walletUnlock.js'
);
const { ChromeUnlockThrottleStore } = await import(
    '../../../packages/extension/src/background/unlockThrottle.js'
);

function storageArea() {
    const values = new Map();
    return {
        async get(key) { return values.has(key) ? { [key]: values.get(key) } : {}; },
        async set(entries) {
            for (const [key, value] of Object.entries(entries)) values.set(key, value);
        },
        async remove(key) { values.delete(key); },
    };
}

function unlockDeps(unlockThrottleStore) {
    return {
        storageBackend: {},
        sessionBackend: { save: vi.fn(async () => {}) },
        signingSecretBackend: { save: vi.fn(async () => {}) },
        metaBackend: {
            load: async () => ({
                kdfParams: { salt: 'test', memory: 1, iterations: 1, parallelism: 1 },
            }),
        },
        unlockThrottleStore,
    };
}

describe('security/passwords/unlock-throttle-restart', () => {
    let priorChrome;
    let now;

    beforeEach(() => {
        priorChrome = globalThis.chrome;
        globalThis.chrome = { storage: { local: storageArea() } };
        mockState.vaultOpenCalls = 0;
        now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        globalThis.chrome = priorChrome;
        vi.restoreAllMocks();
    });

    it('backs off repeated wrong passwords and keeps the delay after a worker restart', async () => {
        const firstWorkerStore = new ChromeUnlockThrottleStore();

        for (let attempt = 0; attempt < 3; attempt += 1) {
            await expect(handleWalletUnlock(
                { password: 'wrong-password' },
                unlockDeps(firstWorkerStore),
            )).rejects.toMatchObject({ name: 'InvalidPasswordError' });
        }

        expect(await firstWorkerStore.load()).toEqual({
            failCount: 3,
            lockedUntil: now + 5_000,
        });
        expect(mockState.vaultOpenCalls).toBe(3);

        // A new store instance models a restarted service worker. Its only
        // state comes from chrome.storage.local.
        const restartedStore = new ChromeUnlockThrottleStore();
        await expect(handleWalletUnlock(
            { password: 'wrong-password' },
            unlockDeps(restartedStore),
        )).rejects.toMatchObject({
            name: 'UnlockThrottledError',
            retryAfterMs: 5_000,
        });
        expect(mockState.vaultOpenCalls).toBe(3);

        now += 5_000;
        await expect(handleWalletUnlock(
            { password: 'wrong-password' },
            unlockDeps(restartedStore),
        )).rejects.toMatchObject({ name: 'InvalidPasswordError' });
        expect(await new ChromeUnlockThrottleStore().load()).toEqual({
            failCount: 4,
            lockedUntil: now + 15_000,
        });
    });
});
