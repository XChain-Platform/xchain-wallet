// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An add-mode restore writes into a vault the user already unlocks and uses.
// Storage refusing a save part-way (a full quota, the page closing) must leave
// that vault exactly as it was, and the retry must produce one restored wallet
// with all of its accounts, never a second copy beside an empty first one.

import { describe, expect, it, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { deriveMasterKey, makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createAccount } from '../../../packages/core/src/schemas/account.js';
import { exportBackupFile, importBackupFile } from '../../../packages/core/src/flows/backupFile.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS * 4 });

const DEVICE_PASSWORD = 'device-pass-123';
const FILE_PASSWORD = 'file-pass-123';
const ACCOUNTS = 3;
const fastKdf = () => makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });

function refusingBackend() {
    const state = { blob: null, saves: 0, refuseFrom: Infinity };
    return {
        state,
        load: async () => state.blob,
        save: async (bytes) => {
            state.saves += 1;
            if (state.saves >= state.refuseFrom) {
                throw Object.assign(new Error('storage refused the write'), { name: 'InvalidStateError' });
            }
            state.blob = new Uint8Array(bytes);
        },
        clear: async () => { state.blob = null; },
    };
}

async function walletRecord(id, kdfParams) {
    const sealed = await encryptWalletSeed({
        password: DEVICE_PASSWORD,
        seed: new TextEncoder().encode('test seed bytes for an add-mode restore'),
        kdfParams,
    });
    return {
        ...createWallet({
            name: `Wallet ${id}`,
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id,
    };
}

async function backupWithAccounts() {
    const kdf = fastKdf();
    const source = new Vault({ backend: refusingBackend(), masterKey: deriveMasterKey(DEVICE_PASSWORD, kdf) });
    await source.open();
    await source.wallets.put(await walletRecord('source', kdf));
    for (let i = 0; i < ACCOUNTS; i += 1) {
        await source.accounts.put({ ...createAccount({ walletId: 'source', name: `Account ${i}`, index: i }), id: `acc-${i}` });
    }
    const { fileContent } = await exportBackupFile({
        vault: source, walletId: 'source', password: FILE_PASSWORD, kdfParams: fastKdf(),
    });
    return fileContent;
}

async function liveVault() {
    const kdf = fastKdf();
    const masterKey = deriveMasterKey(DEVICE_PASSWORD, kdf);
    const backend = refusingBackend();
    const vault = new Vault({ backend, masterKey });
    await vault.open();
    await vault.wallets.put(await walletRecord('live', kdf));
    return { vault, backend, masterKey };
}

async function persisted(backend, masterKey) {
    const reopened = new Vault({
        backend: { load: backend.load, save: async () => {}, clear: async () => {} },
        masterKey,
    });
    await reopened.open();
    return { wallets: await reopened.wallets.list(), accounts: await reopened.accounts.list() };
}

function restore(vault, fileContent) {
    return importBackupFile({
        vault,
        fileContent,
        password: FILE_PASSWORD,
        walletPassword: DEVICE_PASSWORD,
        devicePassword: DEVICE_PASSWORD,
        mode: 'add',
        onConflict: 'error',
    });
}

describe('flows/backupFile add-mode restore atomicity', () => {
    it('leaves the vault unchanged when storage refuses any save of the restore, and a retry adds exactly one wallet', async () => {
        const fileContent = await backupWithAccounts();
        // One save per record is how many points a record-at-a-time restore
        // could stop at: the wallet plus each of its accounts. Storage starts
        // refusing at each of those saves in turn.
        for (let refusal = 1; refusal <= 1 + ACCOUNTS; refusal += 1) {
            const { vault, backend, masterKey } = await liveVault();
            backend.state.refuseFrom = backend.state.saves + refusal;

            let result = null;
            try {
                result = await restore(vault, fileContent);
            } catch (err) {
                expect(err.message).toBe('storage refused the write');
            }

            if (!result) {
                const onDisk = await persisted(backend, masterKey);
                expect(onDisk.wallets.map((w) => w.id), `refusal at save ${refusal}`).toEqual(['live']);
                expect(onDisk.accounts, `refusal at save ${refusal}`).toEqual([]);
                expect((await vault.wallets.list()).map((w) => w.id)).toEqual(['live']);
                expect(await vault.accounts.list()).toEqual([]);

                backend.state.refuseFrom = Infinity;
                result = await restore(vault, fileContent);
            }
            const retried = result;

            const after = await persisted(backend, masterKey);
            expect(after.wallets).toHaveLength(2);
            const restored = after.wallets.filter((w) => w.id !== 'live');
            expect(restored.map((w) => w.id)).toEqual([retried.walletId]);
            expect(after.accounts.filter((a) => a.walletId === retried.walletId)).toHaveLength(ACCOUNTS);
            expect(after.accounts).toHaveLength(ACCOUNTS);
        }
    });

    it('writes a restore with one vault save', async () => {
        const fileContent = await backupWithAccounts();
        const { vault, backend } = await liveVault();
        const before = backend.state.saves;

        await restore(vault, fileContent);

        expect(backend.state.saves - before).toBe(1);
    });
});

describe('Vault.putMany', () => {
    it('validates every record before writing any and refuses a store from another vault', async () => {
        const { vault, backend } = await liveVault();
        const other = (await liveVault()).vault;
        const before = backend.state.saves;
        const account = { ...createAccount({ walletId: 'live', name: 'Extra', index: 1 }), id: 'extra' };

        await expect(vault.putMany([
            { store: vault.accounts, record: account },
            { store: vault.accounts, record: { id: 'broken' } },
        ])).rejects.toThrow();
        await expect(vault.putMany([{ store: other.accounts, record: account }])).rejects.toThrow(TypeError);

        expect(backend.state.saves).toBe(before);
        expect(await vault.accounts.list()).toEqual([]);

        await vault.putMany([{ store: vault.accounts, record: account }]);
        expect((await vault.accounts.list()).map((a) => a.id)).toEqual(['extra']);
        expect(backend.state.saves).toBe(before + 1);
    });
});
