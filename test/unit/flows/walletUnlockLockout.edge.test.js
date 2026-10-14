// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signerMock = vi.hoisted(() => ({
    instances: [],
    unlockImplementation: async () => {},
}));

vi.mock('../../../packages/core/src/signers/SoftwareSigner.js', () => ({
    SoftwareSigner: class SoftwareSigner {
        constructor(options) {
            this.options = options;
            this.unlock = vi.fn((unlockOptions) => signerMock.unlockImplementation(unlockOptions));
            this.lock = vi.fn();
            signerMock.instances.push(this);
        }
    },
}));

import {
    unlockWallet,
    unlockWalletRecord,
    WalletNotFoundError,
    withUnlocked,
    withUnlockedRecord,
} from '../../../packages/core/src/flows/unlockWallet.js';
import {
    __resetLockoutPersistenceForTests,
    applyExternalLockoutState,
    clearLockoutState,
    configureLockoutPersistence,
    delayForAttempts,
    emptyLockoutState,
    getLockoutState,
    getRemainingMs,
    recordFailure,
    recordSuccess,
} from '../../../packages/core/src/flows/lockoutTracking.js';

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function wallet(overrides = {}) {
    return {
        id: 'wallet-1',
        name: 'Wallet',
        encryptedSeed: 'seed',
        encryptedPassphrase: null,
        kdfParams: {},
        passphraseEnabled: false,
        format: 'bip39',
        importedKeys: [],
        ...overrides,
    };
}

function recordArgs(overrides = {}) {
    return {
        wallet: wallet(),
        password: 'wallet password',
        chainRegistry: {},
        sdkRegistry: {},
        ...overrides,
    };
}

function restoreLocalStorage() {
    if (originalLocalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    } else {
        delete globalThis.localStorage;
    }
}

beforeEach(() => {
    signerMock.instances.length = 0;
    signerMock.unlockImplementation = async () => {};
    restoreLocalStorage();
    __resetLockoutPersistenceForTests();
    globalThis.localStorage?.clear();
});

afterEach(() => {
    __resetLockoutPersistenceForTests();
    restoreLocalStorage();
    globalThis.localStorage?.clear();
});

describe('unlockWallet cleanup and callback edges', () => {
    it.each([
        [{ wallet: null }, 'wallet is required'],
        [{ password: '' }, 'password is required'],
        [{ chainRegistry: null }, 'chainRegistry is required'],
    ])('validates unlockWalletRecord before constructing a signer %#', async (override, message) => {
        await expect(unlockWalletRecord(recordArgs(override))).rejects.toThrow(message);
        expect(signerMock.instances).toHaveLength(0);
    });

    it('locks a partially initialized signer when unlock rejects', async () => {
        signerMock.unlockImplementation = async () => { throw new Error('decrypt failed'); };

        await expect(unlockWalletRecord(recordArgs())).rejects.toThrow('decrypt failed');
        expect(signerMock.instances).toHaveLength(1);
        expect(signerMock.instances[0].lock).toHaveBeenCalledOnce();
    });

    it.each([
        [{ vault: null }, 'vault is required'],
        [{ walletId: '' }, 'walletId is required'],
    ])('validates unlockWallet before reading the vault %#', async (override, message) => {
        const get = vi.fn();
        await expect(unlockWallet({
            vault: { wallets: { get } },
            walletId: 'wallet-1',
            password: 'wallet password',
            chainRegistry: {},
            sdkRegistry: {},
            ...override,
        })).rejects.toThrow(message);
        expect(get).not.toHaveBeenCalled();
    });

    it('throws WalletNotFoundError without constructing a signer', async () => {
        await expect(unlockWallet({
            vault: { wallets: { get: vi.fn(async () => null) } },
            walletId: 'missing',
            password: 'wallet password',
            chainRegistry: {},
            sdkRegistry: {},
        })).rejects.toBeInstanceOf(WalletNotFoundError);
        expect(signerMock.instances).toHaveLength(0);
    });

    it.each([
        [withUnlocked, { ...recordArgs(), vault: { wallets: { get: async () => wallet() } }, walletId: 'wallet-1', wallet: undefined }],
        [withUnlockedRecord, recordArgs()],
    ])('rejects a non-function callback before unlocking', async (helper, options) => {
        await expect(helper(options, null)).rejects.toThrow('fn must be a function');
        expect(signerMock.instances).toHaveLength(0);
    });

    it('always locks after a withUnlocked callback failure', async () => {
        const stored = wallet();
        await expect(withUnlocked({
            vault: { wallets: { get: async () => stored } },
            walletId: stored.id,
            password: 'wallet password',
            chainRegistry: {},
            sdkRegistry: {},
        }, async () => {
            throw new Error('callback failed');
        })).rejects.toThrow('callback failed');

        expect(signerMock.instances[0].lock).toHaveBeenCalledOnce();
    });

    it('locks after a successful withUnlockedRecord callback', async () => {
        await expect(withUnlockedRecord(recordArgs(), () => 42)).resolves.toBe(42);
        expect(signerMock.instances[0].lock).toHaveBeenCalledOnce();
    });
});

describe('lockout persistence failure edges', () => {
    it('leaves an empty cache when persistent hydration rejects', async () => {
        await expect(configureLockoutPersistence({
            load: async () => { throw new Error('keychain unavailable'); },
            save: async () => {},
            clear: async () => {},
        })).resolves.toBeUndefined();

        expect(getLockoutState()).toEqual(emptyLockoutState());
    });

    it('floors persisted counters and clears an externally applied empty snapshot', async () => {
        await configureLockoutPersistence({
            load: async () => ({ failedAttempts: 3.9, lockedUntilMs: 12_345.8 }),
            save: async () => {},
            clear: async () => {},
        });
        expect(getLockoutState()).toEqual({ failedAttempts: 3, lockedUntilMs: 12_345 });

        applyExternalLockoutState({ failedAttempts: 0, lockedUntilMs: 0 });
        expect(getLockoutState()).toEqual(emptyLockoutState());
    });

    it('falls back to memory when access to localStorage throws', () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('blocked', 'SecurityError'); },
        });

        expect(recordFailure(1_000)).toEqual({ failedAttempts: 1, lockedUntilMs: 0 });
        expect(getLockoutState()).toEqual({ failedAttempts: 1, lockedUntilMs: 0 });
        expect(() => clearLockoutState()).not.toThrow();
    });

    it('ignores malformed localStorage data and floors valid fractional values', () => {
        globalThis.localStorage.setItem('xchain-wallet:lockout', '{bad json');
        expect(getLockoutState()).toEqual(emptyLockoutState());

        globalThis.localStorage.setItem('xchain-wallet:lockout', JSON.stringify({
            failedAttempts: 4.8, lockedUntilMs: 9_999.9,
        }));
        expect(getLockoutState()).toEqual({ failedAttempts: 4, lockedUntilMs: 9_999 });

        globalThis.localStorage.setItem('xchain-wallet:lockout', JSON.stringify({
            failedAttempts: -1, lockedUntilMs: 0,
        }));
        expect(getLockoutState()).toEqual(emptyLockoutState());
    });

    it('keeps the synchronous cache authoritative when persistent writes throw', async () => {
        await configureLockoutPersistence({
            load: async () => null,
            save: () => { throw new Error('save failed'); },
            clear: () => { throw new Error('clear failed'); },
        });

        recordFailure(1_000);
        expect(getLockoutState()).toEqual({ failedAttempts: 1, lockedUntilMs: 0 });
        recordSuccess();
        expect(getLockoutState()).toEqual(emptyLockoutState());
    });

    it('handles invalid and fractional delay inputs at schedule boundaries', () => {
        expect(delayForAttempts(Number.NaN)).toBe(0);
        expect(delayForAttempts(-1)).toBe(0);
        expect(delayForAttempts(3.9)).toBe(5);
        expect(getRemainingMs(null, 1_000)).toBe(0);
        expect(getRemainingMs({ failedAttempts: 3, lockedUntilMs: 1_000 }, 1_000)).toBe(0);
    });

    it('keeps lockout state in memory when localStorage setItem throws', () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: () => null,
                setItem: () => { throw new Error('quota exceeded'); },
                removeItem: () => {},
            },
        });

        recordFailure(1_000);
        expect(getLockoutState()).toEqual({ failedAttempts: 1, lockedUntilMs: 0 });
        recordFailure(2_000);
        expect(getLockoutState()).toEqual({ failedAttempts: 2, lockedUntilMs: 0 });
    });
});
