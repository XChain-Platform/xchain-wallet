// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A backup restore pays one Argon2id round per distinct set of inputs. A fresh
// restore needs four: the vault key, the backup file's key, the old seal's key
// and the new seal's key. The signer pool opens the restored wallet with the
// new seal's key, which the re-key lends it, instead of deriving a fifth.
//
// Same seams as unlockDerivesOnce.test.js: a counting stand-in for the KDF
// (keyed on password, salt and cost, so a wrong password still yields a wrong
// key and the real AEAD still refuses it), in-memory storage, inert watchers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({
    /** @type {Uint8Array[]} every key the KDF handed out */
    issued: [],
    /** @type {string[]} the password of each derivation, in order */
    passwords: [],
    storageBlob: null,
    meta: null,
}));

/** The stand-in derivation: deterministic, cheap, and sensitive to every input. */
function fakeKey(password, params, base64ToBytes) {
    const h = createHash('sha256');
    h.update('fake-argon2id\0');
    h.update(password);
    h.update('\0');
    h.update(base64ToBytes(params.salt));
    h.update(`\0${params.iterations}\0${params.memory}\0${params.parallelism}`);
    return new Uint8Array(h.digest());
}

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        deriveMasterKeyAsync: async (password, params) => {
            actual.validateKdfParams(params);
            const key = fakeKey(password, params, actual.base64ToBytes);
            state.issued.push(key);
            state.passwords.push(password);
            return key;
        },
        deriveMasterKey: () => { throw new Error('sync KDF reached in a web lane'); },
    };
});

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    class InertWatcher {
        async start() { /* no polling in a unit test */ }
        stop() { /* nothing started */ }
        refresh() { return Promise.resolve(); }
    }
    return {
        ...actual,
        notifications: {
            ...actual.notifications,
            NotificationService: InertWatcher,
            PriceAlertWatcher: InertWatcher,
            GovernancePollWatcher: InertWatcher,
            CoinpayAutopayWatcher: InertWatcher,
            DeadlineWatcher: InertWatcher,
            DispenserEscrowWatcher: InertWatcher,
        },
    };
});

vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({
        load: async () => state.storageBlob,
        save: async (blob) => { state.storageBlob = blob; },
        clear: async () => { state.storageBlob = null; },
    }),
    createMetaBackend: () => ({
        load: async () => state.meta,
        save: async (m) => { state.meta = m; },
        clear: async () => { state.meta = null; },
    }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const core = await import('@xchain-wallet/core');
const kdf = await import('../../../packages/core/src/crypto/kdf.js');
const { SignerPool } = await import('../../../packages/core/src/signers/SignerPool.js');
const {
    exportBackupFile,
    rekeyWalletRecord,
    BackupSeedPasswordError,
} = await import('../../../packages/core/src/flows/backupFile.js');
const { BackupPasswordError } = await import('../../../packages/core/src/crypto/backup.js');
const {
    RESTORE_PASSWORD_LABELS,
    restoreFailureMessage,
} = await import('../../../packages/core/src/flows/restorePasswordCopy.js');
const {
    createWalletLocal,
    importBackupLocal,
    lockWalletLocal,
    sendMessage,
} = await import('../../../packages/web/src/hostBridge.js');

const WALLET_PASSWORD = 'the old phone password';
const BACKUP_PASSWORD = 'the backup file password';
const DEVICE_PASSWORD = 'this device password';
const zeroed = (key) => key.every((b) => b === 0);

/** Each populate call: its options, the pool it filled, and what it returned. */
let populated;

beforeEach(async () => {
    await lockWalletLocal();
    state.storageBlob = null;
    state.meta = null;
    resetCount();
    const realPopulate = SignerPool.prototype.populate;
    vi.spyOn(SignerPool.prototype, 'populate').mockImplementation(async function populateSpy(opts) {
        const summary = await realPopulate.call(this, opts);
        populated.push({ opts, pool: this, summary });
        return summary;
    });
    vi.stubGlobal('fetch', async () => { throw new Error('offline unit test'); });
});

afterEach(async () => {
    await lockWalletLocal();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Forget the derivations a fixture step made, so the next count starts at zero. */
function resetCount() {
    state.issued.length = 0;
    state.passwords.length = 0;
    populated = [];
}

/** Open the stored vault directly, the way a second tab would, under `password`. */
async function openStoredVault(password) {
    const vaultKey = fakeKey(password, state.meta.kdfParams, kdf.base64ToBytes);
    const v = new core.storage.Vault({
        backend: { load: async () => state.storageBlob, save: async (b) => { state.storageBlob = b; } },
        masterKey: vaultKey,
    });
    vaultKey.fill(0);
    await v.open();
    return v;
}

/**
 * A backup of a wallet made on "the old phone", then a wiped install: the
 * starting point of every fresh restore below.
 */
async function backupThenWipe() {
    await createWalletLocal({ password: WALLET_PASSWORD });
    await lockWalletLocal();
    const v = await openStoredVault(WALLET_PASSWORD);
    const [wallet] = await v.wallets.list();
    const { fileContent } = await exportBackupFile({ vault: v, walletId: wallet.id, password: BACKUP_PASSWORD });
    v.close();
    state.storageBlob = null;
    state.meta = null;
    resetCount();
    return { fileContent, wallet };
}

/** The restored wallet, as stored under the new device password. */
async function storedWallet() {
    const v = await openStoredVault(DEVICE_PASSWORD);
    const [w] = await v.wallets.list();
    v.close();
    return w;
}

/** Assert the pool opened the restored wallet with the re-key's key, and nothing kept a key. */
async function expectPooledWithLentKey(walletId) {
    expect(populated).toHaveLength(1);
    const [{ opts, pool, summary }] = populated;
    expect(summary.pooled).toEqual([walletId]);
    expect(summary.skipped).toEqual([]);
    const w = await storedWallet();
    expect(kdf.kdfParamsEqual(opts.masterKeyKdfParams, w.kdfParams)).toBe(true);
    // The bridge's copy of the lent key is zeroed; the signer holds its own.
    expect(zeroed(opts.masterKey)).toBe(true);
    expect(state.issued.every(zeroed)).toBe(true);
    const signerKey = pool.get(walletId).getMasterKey();
    expect(zeroed(signerKey)).toBe(false);
    expect(signerKey).not.toBe(opts.masterKey);
}

describe('importBackupLocal derives once per distinct set of inputs', () => {
    it('file restore: four derivations, the restored wallet pooled with the lent key', async () => {
        const { fileContent, wallet } = await backupThenWipe();
        const res = await importBackupLocal({
            password: DEVICE_PASSWORD,
            backupPassword: BACKUP_PASSWORD,
            walletPassword: WALLET_PASSWORD,
            fileContent,
        });
        expect(res).toMatchObject({ walletId: wallet.id, rekeyed: true });
        expect(state.issued).toHaveLength(4);
        // Vault, backup file, old seal, new seal; never the new seal twice.
        expect(state.passwords).toEqual([DEVICE_PASSWORD, BACKUP_PASSWORD, WALLET_PASSWORD, DEVICE_PASSWORD]);
        await expectPooledWithLentKey(wallet.id);
    });

    it('pointer restore: the same four derivations as the file lane', async () => {
        const { fileContent, wallet } = await backupThenWipe();
        vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => fileContent }));
        await importBackupLocal({
            password: DEVICE_PASSWORD,
            backupPassword: BACKUP_PASSWORD,
            walletPassword: WALLET_PASSWORD,
            pointer: { location: 'https://backups.example/wallet.json' },
        });
        expect(state.issued).toHaveLength(4);
        expect(state.passwords).toEqual([DEVICE_PASSWORD, BACKUP_PASSWORD, WALLET_PASSWORD, DEVICE_PASSWORD]);
        await expectPooledWithLentKey(wallet.id);
    });

    it('a wrong backup password fails as before: file field named, one key past the vault, nothing kept', async () => {
        const { fileContent } = await backupThenWipe();
        const err = await importBackupLocal({
            password: DEVICE_PASSWORD,
            backupPassword: 'not the backup password',
            walletPassword: WALLET_PASSWORD,
            fileContent,
        }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(BackupPasswordError);
        expect(err.message).toBe(new BackupPasswordError().message);
        expect(restoreFailureMessage(err)).toContain(`"${RESTORE_PASSWORD_LABELS.file}"`);
        expect(state.issued).toHaveLength(2);
        expect(state.issued.every(zeroed)).toBe(true);
        expect(populated).toEqual([]);
        expect(state.meta).toBeNull();
    });

    it('a wrong wallet password fails as before: wallet field named, no new seal, nothing kept', async () => {
        const { fileContent } = await backupThenWipe();
        const err = await importBackupLocal({
            password: DEVICE_PASSWORD,
            backupPassword: BACKUP_PASSWORD,
            walletPassword: 'not the wallet password',
            fileContent,
        }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(BackupSeedPasswordError);
        expect(err.message).toBe(new BackupSeedPasswordError('seed').message);
        expect(restoreFailureMessage(err)).toContain(`"${RESTORE_PASSWORD_LABELS.wallet}"`);
        expect(state.issued).toHaveLength(3);
        expect(state.issued.every(zeroed)).toBe(true);
        expect(populated).toEqual([]);
        expect(state.meta).toBeNull();
    });
});

describe('add-mode restore through the in-page host', () => {
    it('three derivations (file, old seal, new seal), unchanged: no pair shares inputs', async () => {
        const { fileContent } = await backupThenWipe();
        await createWalletLocal({ password: DEVICE_PASSWORD });
        resetCount();
        const res = await sendMessage('wallet.importBackup', {
            fileContent,
            password: BACKUP_PASSWORD,
            walletPassword: WALLET_PASSWORD,
            devicePassword: DEVICE_PASSWORD,
            mode: 'add',
        });
        expect(res).toMatchObject({ rekeyed: true });
        expect(state.passwords).toEqual([BACKUP_PASSWORD, WALLET_PASSWORD, DEVICE_PASSWORD]);
        expect(state.issued.every(zeroed)).toBe(true);
        expect(populated).toEqual([]);
    });
});

describe('rekeyWalletRecord onDeviceKey', () => {
    async function sealedWallet() {
        const params = kdf.makeFreshKdfParams();
        const seed = new TextEncoder().encode('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
        const { encryptedSeed, kdfParams } = await core.crypto.encryptWalletSeed({
            password: WALLET_PASSWORD, seed, kdfParams: params,
        });
        seed.fill(0);
        resetCount();
        return { encryptedSeed, kdfParams, importedKeys: [], encryptedPassphrase: null };
    }

    it('lends the new seal key once, then zeroes it', async () => {
        const wallet = await sealedWallet();
        const seen = [];
        await rekeyWalletRecord(wallet, {
            walletPassword: WALLET_PASSWORD,
            devicePassword: DEVICE_PASSWORD,
            onDeviceKey: (key, params) => { seen.push({ copy: key.slice(), key, params }); },
        });
        expect(seen).toHaveLength(1);
        const [{ copy, key, params }] = seen;
        expect(key).toBe(state.issued[1]);
        expect(zeroed(key)).toBe(true);
        expect(copy).toEqual(fakeKey(DEVICE_PASSWORD, wallet.kdfParams, kdf.base64ToBytes));
        expect(kdf.kdfParamsEqual(params, wallet.kdfParams)).toBe(true);
        // A copy, so the callee cannot reach the record's params through it.
        expect(params).not.toBe(wallet.kdfParams);
    });

    it('is never called when the wallet password is wrong', async () => {
        const wallet = await sealedWallet();
        const onDeviceKey = vi.fn();
        await expect(rekeyWalletRecord(wallet, {
            walletPassword: 'wrong', devicePassword: DEVICE_PASSWORD, onDeviceKey,
        })).rejects.toBeInstanceOf(BackupSeedPasswordError);
        expect(onDeviceKey).not.toHaveBeenCalled();
        expect(state.issued).toHaveLength(1);
        expect(state.issued.every(zeroed)).toBe(true);
    });

    it('refuses a non-function before deriving anything', async () => {
        const wallet = await sealedWallet();
        await expect(rekeyWalletRecord(wallet, {
            walletPassword: WALLET_PASSWORD, devicePassword: DEVICE_PASSWORD, onDeviceKey: 'nope',
        })).rejects.toThrow(/onDeviceKey must be a function/);
        expect(state.issued).toHaveLength(0);
    });
});
