// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { unlockWallet } from '../../../packages/core/src/flows/unlockWallet.js';
import {
    __resetLockoutPersistenceForTests,
    applyExternalLockoutState,
    configureLockoutPersistence,
    emptyLockoutState,
    getLockoutState,
    recordFailure,
    recordSuccess,
} from '../../../packages/core/src/flows/lockoutTracking.js';
import {
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    applyExternalPanicModeState,
    assertSigningAllowed,
    configurePanicModePersistence,
    deactivatePanicMode,
    emptyPanicModeState,
    getPanicModeState,
    PanicModeActiveError,
} from '../../../packages/core/src/flows/panicMode.js';
import {
    __resetDuressPersistenceForTests,
    clearDuressPassphrase,
    configureDuressPersistence,
    isDuressConfigured,
    isDuressMatch,
    setDuressPassphrase,
} from '../../../packages/core/src/flows/duressPassphrase.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function rejectedThenable(observed) {
    return {
        then(_resolve, reject) {
            observed();
            reject(new Error('persistence failed'));
        },
    };
}

async function drainPromiseHandlers() {
    await Promise.resolve();
    await Promise.resolve();
}

function inertDuressRecord(fill) {
    return {
        salt: btoa(String.fromCharCode(...new Uint8Array(16).fill(fill))),
        hash: btoa(String.fromCharCode(...new Uint8Array(32).fill(fill))),
    };
}

afterEach(() => {
    __resetLockoutPersistenceForTests();
    __resetPanicModePersistenceForTests();
    __resetDuressPersistenceForTests();
    localStorage.clear();
});

describe('security flow persistence hardening', () => {
    it('consumes rejected async persistence writes without unhandled rejections', async () => {
        const observed = {
            lockoutSave: vi.fn(),
            lockoutClear: vi.fn(),
            panicSave: vi.fn(),
            panicClear: vi.fn(),
            duressSave: vi.fn(),
            duressClear: vi.fn(),
        };
        await configureLockoutPersistence({
            load: async () => emptyLockoutState(),
            save: () => rejectedThenable(observed.lockoutSave),
            clear: () => rejectedThenable(observed.lockoutClear),
        });
        await configurePanicModePersistence({
            load: async () => emptyPanicModeState(),
            save: () => rejectedThenable(observed.panicSave),
            clear: () => rejectedThenable(observed.panicClear),
        });
        await configureDuressPersistence({
            load: async () => null,
            save: () => rejectedThenable(observed.duressSave),
            clear: () => rejectedThenable(observed.duressClear),
        });

        recordFailure(1_000);
        recordSuccess();
        activatePanicMode({ nowMs: 1_000 });
        deactivatePanicMode();
        setDuressPassphrase('emergency phrase');
        clearDuressPassphrase();
        await drainPromiseHandlers();

        for (const handler of Object.values(observed)) {
            expect(handler).toHaveBeenCalledTimes(1);
        }
    });

    it('rejects incomplete persistence backends instead of attaching them', async () => {
        await expect(configureLockoutPersistence({ load: async () => null }))
            .rejects.toThrow('store must implement load, save, and clear');
        await expect(configurePanicModePersistence({ load: async () => null }))
            .rejects.toThrow('store must implement load, save, and clear');
        await expect(configureDuressPersistence({ load: async () => null }))
            .rejects.toThrow('store must implement load, save, and clear');
    });

    it('does not apply stale lockout hydration to a replacement store', async () => {
        const oldLoad = deferred();
        const newLoad = deferred();
        const oldConfigure = configureLockoutPersistence({
            load: () => oldLoad.promise,
            save: async () => {},
            clear: async () => {},
        });
        const newConfigure = configureLockoutPersistence({
            load: () => newLoad.promise,
            save: async () => {},
            clear: async () => {},
        });

        oldLoad.resolve({ failedAttempts: 7, lockedUntilMs: 99_000 });
        await oldConfigure;
        expect(getLockoutState()).toEqual(emptyLockoutState());

        newLoad.resolve({ failedAttempts: 2, lockedUntilMs: 0 });
        await newConfigure;
        expect(getLockoutState()).toEqual({ failedAttempts: 2, lockedUntilMs: 0 });
    });

    it('keeps panic mode fail-closed until the current store hydrates', async () => {
        const oldLoad = deferred();
        const newLoad = deferred();
        const oldConfigure = configurePanicModePersistence({
            load: () => oldLoad.promise,
            save: async () => {},
            clear: async () => {},
        });
        const newConfigure = configurePanicModePersistence({
            load: () => newLoad.promise,
            save: async () => {},
            clear: async () => {},
        });

        oldLoad.resolve(emptyPanicModeState());
        await oldConfigure;
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);

        const current = {
            activatedAt: 10,
            expiresAt: Date.now() + 60_000,
            durationMs: 60_000,
            armedBy: 'self',
        };
        newLoad.resolve(current);
        await newConfigure;
        expect(getPanicModeState()).toEqual(current);
    });

    it('does not apply stale duress hydration to a replacement store', async () => {
        const oldLoad = deferred();
        const newLoad = deferred();
        const oldConfigure = configureDuressPersistence({
            load: () => oldLoad.promise,
            save: async () => {},
            clear: async () => {},
        });
        const newConfigure = configureDuressPersistence({
            load: () => newLoad.promise,
            save: async () => {},
            clear: async () => {},
        });

        oldLoad.resolve(inertDuressRecord(0));
        await oldConfigure;
        expect(isDuressConfigured()).toBe(false);

        newLoad.resolve(inertDuressRecord(1));
        await newConfigure;
        expect(isDuressConfigured()).toBe(true);
    });

    it('does not overwrite local safety updates when an older hydration finishes', async () => {
        const lockoutLoad = deferred();
        const panicLoad = deferred();
        const duressLoad = deferred();
        const lockoutConfigure = configureLockoutPersistence({
            load: () => lockoutLoad.promise,
            save: async () => {},
            clear: async () => {},
        });
        const panicConfigure = configurePanicModePersistence({
            load: () => panicLoad.promise,
            save: async () => {},
            clear: async () => {},
        });
        const duressConfigure = configureDuressPersistence({
            load: () => duressLoad.promise,
            save: async () => {},
            clear: async () => {},
        });

        recordFailure(1_000);
        const panic = activatePanicMode({ nowMs: Date.now() });
        setDuressPassphrase('current emergency phrase');
        lockoutLoad.resolve(emptyLockoutState());
        panicLoad.resolve(emptyPanicModeState());
        duressLoad.resolve(null);
        await Promise.all([lockoutConfigure, panicConfigure, duressConfigure]);

        expect(getLockoutState().failedAttempts).toBe(1);
        expect(getPanicModeState()).toEqual(panic);
        expect(isDuressMatch('current emergency phrase')).toBe(true);
    });

    it('rejects malformed persisted safety values', async () => {
        applyExternalLockoutState({
            failedAttempts: Number.POSITIVE_INFINITY,
            lockedUntilMs: 1,
        });
        expect(getLockoutState()).toEqual(emptyLockoutState());

        applyExternalPanicModeState({
            activatedAt: 1,
            expiresAt: Number.POSITIVE_INFINITY,
            durationMs: Number.POSITIVE_INFINITY,
        });
        expect(getPanicModeState()).toEqual(emptyPanicModeState());

        await configureDuressPersistence({
            load: async () => ({ salt: '', hash: '' }),
            save: async () => {},
            clear: async () => {},
        });
        expect(isDuressConfigured()).toBe(false);
    });

    it('refuses a wallet record whose id differs from the requested id', async () => {
        const get = vi.fn(async () => ({ id: 'wallet-b' }));

        await expect(unlockWallet({
            vault: { wallets: { get } },
            walletId: 'wallet-a',
            password: 'password',
            chainRegistry: {},
            sdkRegistry: {},
        })).rejects.toThrow('loaded wallet record does not match walletId');
        expect(get).toHaveBeenCalledWith('wallet-a');
    });
});
