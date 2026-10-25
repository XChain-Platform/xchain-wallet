// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A fresh-device create or restore persists the vault in one write, then the
// kdf params that make it openable. A reload or crash between per-record
// writes would otherwise leave a blob with no kdf params: the app shows an
// Unlock screen that cannot unlock and every onboarding lane answers that a
// wallet already exists.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({
    /** @type {Uint8Array[]} every key the KDF handed out */
    issued: [],
    /** @type {string[]} the password of each derivation, in order */
    passwords: [],
    storageBlob: null,
    meta: null,
    /** @type {string[]} every persisted write, in order */
    writes: [],
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
        save: async (blob) => { state.writes.push('blob'); state.storageBlob = blob; },
        clear: async () => { state.storageBlob = null; },
    }),
    createMetaBackend: () => ({
        load: async () => state.meta,
        save: async (m) => { state.writes.push('meta'); state.meta = m; },
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
    state.writes.length = 0;
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

describe('fresh-device onboarding persists in one commit', () => {
    it('a restore writes the vault blob once, then the kdf params', async () => {
        const { fileContent } = await backupThenWipe();
        state.writes.length = 0;
        await importBackupLocal({
            password: DEVICE_PASSWORD,
            backupPassword: BACKUP_PASSWORD,
            walletPassword: WALLET_PASSWORD,
            fileContent,
        });
        expect(state.writes).toEqual(['blob', 'meta']);
    });

    it('a created wallet writes the vault blob once, then the kdf params', async () => {
        await createWalletLocal({ password: DEVICE_PASSWORD });
        expect(state.writes).toEqual(['blob', 'meta']);
    });

    it('later changes persist one write each once the commit is done', async () => {
        await createWalletLocal({ password: DEVICE_PASSWORD });
        const before = state.writes.length;
        await sendMessage('settings.update', { patch: { fiatCurrency: 'EUR' } });
        expect(state.writes.slice(before)).toEqual(['blob']);
    });
});
