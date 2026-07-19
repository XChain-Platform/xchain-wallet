// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: §15.4 QR-from-backup-pointer restore. Exports a §19.4
// backup, publishes it behind a fake resolver keyed by the pointer's
// location, then drives `restoreFromBackupPointer` end-to-end against an
// in-memory vault. The resolver stands in for the shell's https / on-chain
// fetch so the flow stays network-free.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    exportBackupFile,
    restoreFromBackupPointer,
    BackupPointerUnresolvedError,
} from '../../../packages/core/src/flows/backupFile.js';
import { buildBackupPointer } from '../../../packages/core/src/uri/backupPointer.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        _map: m,
    };
}

function memSettings(initial = null) {
    let v = initial ? JSON.parse(JSON.stringify(initial)) : null;
    return {
        get: async () => (v ? JSON.parse(JSON.stringify(v)) : null),
        put: async (next) => { v = JSON.parse(JSON.stringify(next)); },
    };
}

function makeVault({ wallets = [], accounts = [], addresses = [], contacts = [], connectedSites = [], pendingTxs = [], settings = null } = {}) {
    return {
        wallets: memCollection(wallets),
        accounts: memCollection(accounts),
        addresses: memCollection(addresses),
        contacts: memCollection(contacts),
        connectedSites: memCollection(connectedSites),
        pendingTxs: memCollection(pendingTxs),
        settings: memSettings(settings),
    };
}

function sampleWallet(id) {
    return {
        id,
        schemaVersion: 1,
        name: `Wallet ${id}`,
        kind: 'mnemonic',
        encryptedSeed: { iv: 'AAAA', tag: 'BBBB', ct: 'CCCC' },
        kdf: KDF_PARAMS,
        importedKeys: [],
    };
}
function sampleAccount(id, walletId) {
    return { id, walletId, schemaVersion: 1, label: `Account ${id}`, accountIndex: 0 };
}
function sampleAddress(id, accountId) {
    return {
        id, schemaVersion: 1, accountId, address: `bc1q${id}`,
        derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
    };
}

describe('integration/flows/restore-from-backup-pointer', () => {
    const password = 'secret-pw';
    const location = 'https://backups.example/wallet-src.json';
    let exported;
    let resolver;

    beforeEach(async () => {
        const sourceVault = makeVault({
            wallets: [sampleWallet('src')],
            accounts: [sampleAccount('acc-src', 'src')],
            addresses: [sampleAddress('addr-1', 'acc-src')],
        });
        const r = await exportBackupFile({
            vault: sourceVault, walletId: 'src', password, kdfParams: KDF_PARAMS,
        });
        exported = r.fileContent;
        // Fake location -> content store keyed by the pointer's location.
        const store = new Map([[location, exported]]);
        resolver = async (pointer) => store.get(pointer.location) ?? null;
    });

    it('restores a wallet from a pointer URI string end-to-end', async () => {
        const vault = makeVault();
        const uri = buildBackupPointer({ location, name: 'Cold rig' });
        const r = await restoreFromBackupPointer({
            vault, pointer: uri, password, resolveBackupContent: resolver,
        });
        expect(r.walletId).toBe('src');
        expect(r.pointer.location).toBe(location);
        expect(r.pointer.name).toBe('Cold rig');
        const wallets = await vault.wallets.list();
        expect(wallets.map((w) => w.id)).toEqual(['src']);
    });

    it('accepts an already-parsed pointer object', async () => {
        const vault = makeVault();
        const r = await restoreFromBackupPointer({
            vault,
            pointer: { version: 1, location, raw: buildBackupPointer({ location }) },
            password,
            resolveBackupContent: resolver,
        });
        expect(r.walletId).toBe('src');
    });

    it('honors add-mode (re-mints ids so the restore coexists)', async () => {
        const vault = makeVault({
            wallets: [sampleWallet('keep')],
            accounts: [sampleAccount('acc-keep', 'keep')],
        });
        const r = await restoreFromBackupPointer({
            vault, pointer: buildBackupPointer({ location }), password,
            resolveBackupContent: resolver, mode: 'add',
        });
        expect(r.walletId).not.toBe('src');
        const wallets = await vault.wallets.list();
        expect(wallets.map((w) => w.id).sort()).toEqual([r.walletId, 'keep'].sort());
    });

    it('throws BackupPointerUnresolvedError when the resolver yields nothing', async () => {
        const vault = makeVault();
        const uri = buildBackupPointer({ location: 'https://backups.example/missing.json' });
        await expect(restoreFromBackupPointer({
            vault, pointer: uri, password, resolveBackupContent: resolver,
        })).rejects.toThrow(BackupPointerUnresolvedError);
    });

    it('requires a resolver function', async () => {
        const vault = makeVault();
        await expect(restoreFromBackupPointer({
            vault, pointer: buildBackupPointer({ location }), password,
        })).rejects.toThrow(/resolveBackupContent must be a function/);
    });

    it('requires a password', async () => {
        const vault = makeVault();
        await expect(restoreFromBackupPointer({
            vault, pointer: buildBackupPointer({ location }), password: '',
            resolveBackupContent: resolver,
        })).rejects.toThrow(/password is required/);
    });

    it('rejects a malformed pointer string', async () => {
        const vault = makeVault();
        await expect(restoreFromBackupPointer({
            vault, pointer: 'xchain-backup:1?name=hi', password,
            resolveBackupContent: resolver,
        })).rejects.toThrow(/loc/);
    });

    it('surfaces the wrong-password decrypt failure from importBackupFile', async () => {
        const vault = makeVault();
        await expect(restoreFromBackupPointer({
            vault, pointer: buildBackupPointer({ location }), password: 'wrong-password',
            resolveBackupContent: resolver,
        })).rejects.toThrow();
    });
});
