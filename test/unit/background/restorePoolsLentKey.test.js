// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The pre-host fresh restore (extension and desktop) pools the restored wallet
// with the re-key's own key while the vault is open, so the host build finds
// the pool full and does not derive that key again from the cached password.
//
// The KDF is a counting stand-in keyed on password, salt and cost (both the
// sync form the pre-host lane uses for the vault and the async form core
// uses), mocked at kdf.js so every importer sees it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({
    /** @type {Uint8Array[]} every key the KDF handed out */
    issued: [],
    /** @type {string[]} the password of each derivation, in order */
    passwords: [],
}));

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
    const derive = (password, params) => {
        actual.validateKdfParams(params);
        const key = fakeKey(password, params, actual.base64ToBytes);
        state.issued.push(key);
        state.passwords.push(password);
        return key;
    };
    return {
        ...actual,
        deriveMasterKey: derive,
        deriveMasterKeyAsync: async (password, params) => derive(password, params),
    };
});

const { dispatchPreHost } = await import('../../../packages/extension/src/background/sessionMeta.js');
const { SignerPool } = await import('../../../packages/core/src/signers/SignerPool.js');
const { exportBackupFile, BackupSeedPasswordError } = await import('../../../packages/core/src/flows/backupFile.js');
const { encryptWalletSeed } = await import('../../../packages/core/src/crypto/walletBlob.js');
const { makeFreshKdfParams } = await import('../../../packages/core/src/crypto/kdf.js');
const { createWallet } = await import('../../../packages/core/src/schemas/wallet.js');

const WALLET_PASSWORD = 'the old phone password';
const BACKUP_PASSWORD = 'the backup file password';
const DEVICE_PASSWORD = 'this device password';
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const zeroed = (key) => key.every((b) => b === 0);

function memBackend() {
    let v = null;
    return { load: async () => v, save: async (next) => { v = next; }, clear: async () => { v = null; } };
}

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => [...m.values()].map((r) => structuredClone(r)),
        delete: async (id) => { m.delete(id); },
    };
}

let fileContent;
let populated;

beforeEach(async () => {
    const seed = new TextEncoder().encode(MNEMONIC);
    const sealed = await encryptWalletSeed({ password: WALLET_PASSWORD, seed, kdfParams: makeFreshKdfParams() });
    seed.fill(0);
    const wallet = {
        ...createWallet({
            name: 'Wallet From The Old Phone',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id: 'src',
    };
    const source = {
        wallets: memCollection([wallet]),
        accounts: memCollection(),
        addresses: memCollection(),
        contacts: memCollection(),
        connectedSites: memCollection(),
        pendingTxs: memCollection(),
        settings: { get: async () => null, put: async () => {} },
    };
    ({ fileContent } = await exportBackupFile({ vault: source, walletId: 'src', password: BACKUP_PASSWORD }));
    state.issued.length = 0;
    state.passwords.length = 0;
    populated = [];
    const realPopulate = SignerPool.prototype.populate;
    vi.spyOn(SignerPool.prototype, 'populate').mockImplementation(async function populateSpy(opts) {
        const summary = await realPopulate.call(this, opts);
        populated.push({ opts, summary });
        return summary;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

function restore(over = {}, deps = {}) {
    return dispatchPreHost('wallet.importBackup.fresh', {
        password: DEVICE_PASSWORD,
        backupPassword: BACKUP_PASSWORD,
        walletPassword: WALLET_PASSWORD,
        fileContent,
        ...over,
    }, {
        storageBackend: memBackend(),
        sessionBackend: memBackend(),
        signingSecretBackend: memBackend(),
        metaBackend: memBackend(),
        chainRegistry: {},
        sdkRegistry: {},
        ...deps,
    });
}

describe('pre-host fresh restore pools the restored wallet with the lent key', () => {
    it('four derivations, the wallet pooled, every key zeroed', async () => {
        const pool = new SignerPool();
        const res = await restore({}, { signerPool: pool });
        expect(res).toMatchObject({ walletId: 'src', rekeyed: true });
        expect(state.passwords).toEqual([DEVICE_PASSWORD, BACKUP_PASSWORD, WALLET_PASSWORD, DEVICE_PASSWORD]);
        expect(populated).toHaveLength(1);
        const [{ opts, summary }] = populated;
        expect(summary.pooled).toEqual(['src']);
        expect(summary.skipped).toEqual([]);
        expect(pool.size()).toBe(1);
        expect(zeroed(opts.masterKey)).toBe(true);
        expect(state.issued.every(zeroed)).toBe(true);
        expect(zeroed(pool.get('src').getMasterKey())).toBe(false);
    });

    it('without a pool (a shell that passes none) it restores exactly as before', async () => {
        await restore();
        expect(state.issued).toHaveLength(4);
        expect(populated).toEqual([]);
        expect(state.issued.every(zeroed)).toBe(true);
    });

    it('a wrong wallet password still fails with the same error and pools nothing', async () => {
        const pool = new SignerPool();
        const err = await restore({ walletPassword: 'not it' }, { signerPool: pool }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(BackupSeedPasswordError);
        expect(err.message).toBe(new BackupSeedPasswordError('seed').message);
        expect(state.issued).toHaveLength(3);
        expect(populated).toEqual([]);
        expect(pool.size()).toBe(0);
        expect(state.issued.every(zeroed)).toBe(true);
    });

    it('a failure after pooling locks the pool again: no signer outlives a failed restore', async () => {
        const pool = new SignerPool();
        const metaBackend = memBackend();
        metaBackend.save = async () => { throw new Error('disk full'); };
        await expect(restore({}, { signerPool: pool, metaBackend })).rejects.toThrow('disk full');
        expect(populated).toHaveLength(1);
        expect(pool.size()).toBe(0);
        expect(zeroed(populated[0].opts.masterKey)).toBe(true);
        expect(state.issued.every(zeroed)).toBe(true);
    });
});
