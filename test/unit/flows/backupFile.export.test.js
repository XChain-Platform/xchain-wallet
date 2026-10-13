// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({ encoded: null }));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        encodeBackupEnvelope: vi.fn(async (input) => {
            capture.encoded = input;
            return {
                magic: 'XCHAIN-WALLET-BACKUP',
                formatVersion: 1,
                createdAt: '2026-10-13T18:00:00.000Z',
                walletName: input.walletName,
                encryption: {
                    algorithm: 'aes-256-gcm',
                    kdf: input.kdfParams,
                    iv: 'aXY=',
                    tag: 'dGFn',
                },
                payload: 'Y2lwaGVydGV4dA==',
            };
        }),
    };
});

import {
    BACKUP_PAYLOAD_VERSION,
    exportBackupFile,
} from '../../../packages/core/src/flows/backupFile.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

function collection(records) {
    return {
        get: vi.fn(async (id) => records.find((record) => record.id === id) ?? null),
        list: vi.fn(async () => records),
    };
}

function vaultFixture() {
    const wallet = {
        id: 'wallet-1',
        name: 'Cold Vault',
        importedKeys: [{ addressId: 'imported-address' }],
    };
    const ownAccount = { id: 'account-1', walletId: wallet.id };
    const otherAccount = { id: 'account-2', walletId: 'wallet-2' };
    const ownAddress = { id: 'address-1', accountId: ownAccount.id, address: 'bc1qown' };
    const importedAddress = { id: 'imported-address', accountId: null, address: '1imported' };
    const otherAddress = { id: 'address-2', accountId: otherAccount.id, address: 'bc1qother' };
    const ownPending = { id: 'pending-1', fromAddress: ownAddress.address };
    const otherPending = { id: 'pending-2', fromAddress: otherAddress.address };
    const contact = { id: 'contact-1' };
    const connectedSite = { id: 'site-1' };
    const settings = { schemaVersion: 1, activeNetwork: 'mainnet' };
    return {
        wallet,
        ownAccount,
        ownAddress,
        importedAddress,
        ownPending,
        contact,
        connectedSite,
        settings,
        vault: {
            wallets: collection([wallet]),
            accounts: collection([ownAccount, otherAccount]),
            addresses: collection([ownAddress, importedAddress, otherAddress]),
            contacts: collection([contact]),
            connectedSites: collection([connectedSite]),
            pendingTxs: collection([ownPending, otherPending]),
            settings: { get: vi.fn(async () => settings) },
        },
    };
}

beforeEach(() => {
    capture.encoded = null;
});

describe('exportBackupFile', () => {
    it('rejects a weak backup password before reading the vault', async () => {
        const fixture = vaultFixture();

        await expect(exportBackupFile({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'short',
            kdfParams: KDF_PARAMS,
        })).rejects.toThrow('password must be at least 8 characters');
        expect(fixture.vault.wallets.get).not.toHaveBeenCalled();
    });

    it('builds the documented target-wallet payload and returns a JSON envelope string', async () => {
        const fixture = vaultFixture();
        const result = await exportBackupFile({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'backup-secret',
            kdfParams: KDF_PARAMS,
        });

        expect(capture.encoded).toMatchObject({
            password: 'backup-secret',
            walletName: fixture.wallet.name,
            kdfParams: KDF_PARAMS,
        });
        expect(capture.encoded.payload).toEqual({
            payloadVersion: BACKUP_PAYLOAD_VERSION,
            wallet: fixture.wallet,
            accounts: [fixture.ownAccount],
            addresses: [fixture.ownAddress, fixture.importedAddress],
            contacts: [fixture.contact],
            connectedSites: [fixture.connectedSite],
            settings: fixture.settings,
            signers: [],
            pendingTxs: [fixture.ownPending],
        });
        expect(typeof result.fileContent).toBe('string');
        expect(JSON.parse(result.fileContent)).toEqual(result.envelope);
        expect(result.fileContent).toContain('\n  "magic": "XCHAIN-WALLET-BACKUP"');
    });
});
