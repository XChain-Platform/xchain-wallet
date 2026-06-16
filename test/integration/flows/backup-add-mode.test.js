// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: §19.4 / Cluster H FOLLOWUP 3 add-mode encrypted backup
// restore. Drives the full encode → import (mode='add') round-trip
// against an in-memory vault, asserts the wallet lands as a new
// record alongside an existing wallet without colliding on ids.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    exportBackupFile,
    importBackupFile,
} from '../../../packages/core/src/flows/backupFile.js';

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
        importedKeys: [{ addressId: `addr-imp-${id}` }],
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

describe('integration/flows/backup-add-mode', () => {
    let sourceVault;
    let exported;
    const password = 'secret-pw';

    beforeEach(async () => {
        sourceVault = makeVault({
            wallets: [sampleWallet('src')],
            accounts: [sampleAccount('acc-src', 'src')],
            addresses: [
                sampleAddress('addr-derived-1', 'acc-src'),
                { ...sampleAddress('addr-imp-src', null), accountId: null },
            ],
        });
        const r = await exportBackupFile({
            vault: sourceVault,
            walletId: 'src',
            password,
            kdfParams: KDF_PARAMS,
        });
        exported = r.fileContent;
    });

    it('add mode lands a fresh wallet alongside an existing wallet without id collisions', async () => {
        // Target vault already has a wallet (different id, no overlap).
        const targetVault = makeVault({
            wallets: [sampleWallet('keep')],
            accounts: [sampleAccount('acc-keep', 'keep')],
            addresses: [sampleAddress('addr-keep', 'acc-keep')],
        });
        const r = await importBackupFile({
            vault: targetVault,
            fileContent: exported,
            password,
            mode: 'add',
        });
        // New wallet id != source 'src' (re-minted on the way in).
        expect(r.walletId).not.toBe('src');
        expect(r.walletId).toMatch(/^[0-9a-f-]{36}$/);
        // Both wallets coexist.
        const wallets = await targetVault.wallets.list();
        expect(wallets.map((w) => w.id).sort()).toEqual([r.walletId, 'keep'].sort());
        // Restored wallet has its own fresh accounts; 'acc-keep' wasn't touched.
        const accounts = await targetVault.accounts.list();
        const restoredAccountIds = accounts
            .filter((a) => a.walletId === r.walletId)
            .map((a) => a.id);
        expect(restoredAccountIds).toHaveLength(1);
        expect(restoredAccountIds[0]).not.toBe('acc-src');
        // Original 'acc-keep' survives intact.
        const keep = accounts.find((a) => a.id === 'acc-keep');
        expect(keep).toBeTruthy();
        expect(keep.walletId).toBe('keep');
    });

    it('add mode lets the user import the same backup twice into the same vault', async () => {
        const targetVault = makeVault();
        const first = await importBackupFile({
            vault: targetVault, fileContent: exported, password, mode: 'add',
        });
        const second = await importBackupFile({
            vault: targetVault, fileContent: exported, password, mode: 'add',
        });
        expect(first.walletId).not.toBe(second.walletId);
        const wallets = await targetVault.wallets.list();
        expect(wallets).toHaveLength(2);
    });

    it('fresh mode keeps the original wallet id (default behavior unchanged)', async () => {
        const targetVault = makeVault();
        const r = await importBackupFile({
            vault: targetVault, fileContent: exported, password,
        });
        expect(r.walletId).toBe('src');
    });

    it('rejects an unknown mode value', async () => {
        const targetVault = makeVault();
        await expect(importBackupFile({
            vault: targetVault, fileContent: exported, password, mode: 'whatever',
        })).rejects.toThrow(/mode must be 'fresh' or 'add'/);
    });
});
