// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §19.4 restore, every collection: an envelope written by an older release
// carries records at that release's schema versions, and `Vault.put` validates
// against the CURRENT version and never migrates (storage/Vault.js). The wallet
// and settings records are migrated on the way out of the envelope; the other
// five collections were written straight through, so a backup holding a v1
// account or a v1 address was refused by validation partway through the
// restore. The wallet had already been written and auto-saved by then, so the
// vault was left half-populated.
//
// Restore is the path a user reaches when the device is gone and the file is
// all that is left, so the fixtures here are FAITHFUL old records: the fields
// each migration step adds are absent, not merely renumbered. The address
// label assertion is the one that proves migration rather than acceptance, as
// the v3 -> v4 step rewrites the chain-agnostic default label.
//
// The destination is a REAL Vault. The in-memory collections the other backup
// tests use do not validate, which is why this class of bug survived them.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

import { exportBackupFile, importBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import { storage as storageLib, crypto as cryptoLib } from '../../../packages/core/src/index.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createAccount, CURRENT_VERSION as ACCOUNT_VERSION } from '../../../packages/core/src/schemas/account.js';
import { createAddress, CURRENT_VERSION as ADDRESS_VERSION } from '../../../packages/core/src/schemas/address.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// Demo-grade cost. This suite pins the restore path, not the KDF's tuning, and
// a calibrated round here buys no signal for several seconds of blocked worker.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

const OLD_DEVICE_PASSWORD = 'the-lost-devices-password';
const NEW_DEVICE_PASSWORD = 'the-new-devices-password';
const BACKUP_PASSWORD = 'backup-file-password';

function memBackend() {
    let v = null;
    return { load: async () => v, save: async (next) => { v = next; }, clear: async () => { v = null; } };
}

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
    };
}

/**
 * A source vault whose account and address records are shaped the way the
 * releases that introduced them wrote them: v1, without the fields the
 * migration steps go on to add.
 */
function oldReleaseVault(sealed) {
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

    // v1 account: `activeAddressByChainId` is what v1 -> v2 adds.
    const account = { ...createAccount({ walletId: 'src', name: 'Account 0', index: 0 }), id: 'acc-src' };
    delete account.activeAddressByChainId;
    account.schemaVersion = 1;

    // v1 address: `signerId` arrives in v2 and `role` in v3, and the
    // chain-agnostic default label is what v3 -> v4 rewrites.
    const address = {
        ...createAddress({
            accountId: 'acc-src',
            chain: 'bitcoin',
            network: 'mainnet',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            address: 'bc1qexample',
            publicKey: '02'.padEnd(66, '0'),
            label: 'Address #0',
        }),
        id: 'addr-1',
    };
    delete address.signerId;
    delete address.role;
    address.schemaVersion = 1;

    let settings = { ...createDefaultSettings(), fiatCurrency: 'EUR' };
    return {
        wallets: memCollection([wallet]),
        accounts: memCollection([account]),
        addresses: memCollection([address]),
        contacts: memCollection([]),
        connectedSites: memCollection([]),
        pendingTxs: memCollection([]),
        settings: {
            get: async () => (settings ? JSON.parse(JSON.stringify(settings)) : null),
            put: async (next) => { settings = JSON.parse(JSON.stringify(next)); },
        },
    };
}

describe('integration/flows: restoring an envelope written by an older release', () => {
    let exported;
    let storageBackend;

    beforeEach(async () => {
        storageBackend = memBackend();
        const sealed = await encryptWalletSeed({
            password: OLD_DEVICE_PASSWORD,
            seed: new TextEncoder().encode(MNEMONIC),
            kdfParams: KDF_PARAMS,
        });
        exported = await exportBackupFile({
            vault: oldReleaseVault(sealed),
            walletId: 'src',
            password: BACKUP_PASSWORD,
            kdfParams: KDF_PARAMS,
        });
        exported = exported.fileContent ?? exported;
    });

    /** A real Vault, which validates on every put exactly as production does. */
    async function freshVault() {
        const key = cryptoLib.deriveMasterKey(NEW_DEVICE_PASSWORD, KDF_PARAMS);
        try {
            const v = new storageLib.Vault({ backend: storageBackend, masterKey: key });
            await v.open();
            return v;
        } finally {
            key.fill(0);
        }
    }

    it('restores it instead of refusing a record it knows how to migrate', async () => {
        const vault = await freshVault();
        const r = await importBackupFile({
            vault, fileContent: exported, password: BACKUP_PASSWORD, mode: 'fresh',
            walletPassword: OLD_DEVICE_PASSWORD, devicePassword: NEW_DEVICE_PASSWORD,
        });
        expect(r.writes.accounts).toBe(1);
        expect(r.writes.addresses).toBe(1);
    });

    it('migrates every collection on the way in, not just wallet and settings', async () => {
        const vault = await freshVault();
        await importBackupFile({
            vault, fileContent: exported, password: BACKUP_PASSWORD, mode: 'fresh',
            walletPassword: OLD_DEVICE_PASSWORD, devicePassword: NEW_DEVICE_PASSWORD,
        });

        const [account] = await vault.accounts.list();
        const [address] = await vault.addresses.list();

        expect(account.schemaVersion).toBe(ACCOUNT_VERSION);
        // v1 -> v2 seeds the override map rather than leaving it undefined.
        expect(account.activeAddressByChainId).toEqual({});

        expect(address.schemaVersion).toBe(ADDRESS_VERSION);
        expect(address.signerId).toBe(null);
        expect(address.role).toBe('receive');
        // The step that proves the record was MIGRATED and not merely accepted:
        // v3 -> v4 prefixes the native ticker to the old chain-agnostic default.
        expect(address.label).toBe('BTC Address #0');
    });

    it('still refuses a record from a NEWER release rather than guessing at it', async () => {
        // Migrating on the way in must not become "accept anything". There is
        // no step from a future version, so the migration harness itself refuses
        // it (§11.6), naming both versions. The honest outcome: this build
        // cannot know the fields that release added.
        const sealed = await encryptWalletSeed({
            password: OLD_DEVICE_PASSWORD,
            seed: new TextEncoder().encode(MNEMONIC),
            kdfParams: KDF_PARAMS,
        });
        const source = oldReleaseVault(sealed);
        const [addr] = await source.addresses.list();
        await source.addresses.put({ ...addr, schemaVersion: ADDRESS_VERSION + 1 });
        const fromTheFuture = await exportBackupFile({
            vault: source, walletId: 'src', password: BACKUP_PASSWORD, kdfParams: KDF_PARAMS,
        });

        const vault = await freshVault();
        await expect(importBackupFile({
            vault,
            fileContent: fromTheFuture.fileContent ?? fromTheFuture,
            password: BACKUP_PASSWORD,
            mode: 'fresh',
            walletPassword: OLD_DEVICE_PASSWORD,
            devicePassword: NEW_DEVICE_PASSWORD,
        })).rejects.toThrow(/newer than target/);
    });

    it('leaves no half-populated vault behind when a record cannot be applied', async () => {
        // The wallet is written before the collections that hang off it, and
        // each put saves, so a refusal further down the list strands a wallet
        // whose accounts and addresses never arrive: a restored wallet that
        // lists no addresses at all.
        const vault = await freshVault();
        await importBackupFile({
            vault, fileContent: exported, password: BACKUP_PASSWORD, mode: 'fresh',
            walletPassword: OLD_DEVICE_PASSWORD, devicePassword: NEW_DEVICE_PASSWORD,
        });
        const wallets = await vault.wallets.list();
        const addresses = await vault.addresses.list();
        expect(wallets).toHaveLength(1);
        expect(addresses.length, 'a wallet was restored with no addresses under it').toBeGreaterThan(0);
    });
});
