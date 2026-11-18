// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import {
    decodeBackupEnvelope, encodeBackupEnvelope, parseBackupEnvelope, stringifyBackupEnvelope,
} from '../../../packages/core/src/crypto/backup.js';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { exportBackupFile, importBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import { registerSigner } from '../../../packages/core/src/flows/registerSigner.js';
import { resolveSigner } from '../../../packages/core/src/flows/resolveSigner.js';
import { createAccount } from '../../../packages/core/src/schemas/account.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';
import { createSignerRecord } from '../../../packages/core/src/schemas/signer.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS * 3 });

const FILE_PASSWORD = 'backup-file-password';
const WALLET_PASSWORD = 'wallet-password';
const fastKdf = () => makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });

async function openVault(fill) {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(fill) });
    await vault.open();
    return vault;
}

async function hardwareSource() {
    const vault = await openVault(4);
    const sealed = await encryptWalletSeed({
        password: WALLET_PASSWORD,
        seed: new TextEncoder().encode('backup signer routing seed'),
        kdfParams: fastKdf(),
    });
    const wallet = {
        ...createWallet({
            name: 'Signer backup',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id: 'wallet-source',
    };
    const account = {
        ...createAccount({ walletId: wallet.id, name: 'Hardware account', index: 0 }),
        id: 'account-source',
    };
    const signer = {
        ...createSignerRecord({
            walletId: wallet.id,
            kind: 'ledger',
            vendor: 'ledger',
            model: 'nanoX',
            deviceIdentifier: 'ledger-device',
        }),
        id: 'signer-source',
    };
    const address = {
        ...createAddress({
            accountId: account.id,
            chain: 'bitcoin',
            network: 'mainnet',
            source: 'ledger',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            address: 'bc1qhardwarebackup',
            publicKey: `02${'a'.repeat(64)}`,
            signerId: signer.id,
        }),
        id: 'address-source',
    };
    await vault.putMany([
        { store: vault.wallets, record: wallet },
        { store: vault.accounts, record: account },
        { store: vault.signers, record: signer },
        { store: vault.addresses, record: address },
    ]);
    return { vault, wallet, signer, address };
}

async function backup(source) {
    return (await exportBackupFile({
        vault: source.vault,
        walletId: source.wallet.id,
        password: FILE_PASSWORD,
        kdfParams: fastKdf(),
    })).fileContent;
}

async function restore(vault, fileContent, mode = 'fresh', onConflict = 'error') {
    return importBackupFile({
        vault,
        fileContent,
        password: FILE_PASSWORD,
        walletPassword: WALLET_PASSWORD,
        devicePassword: WALLET_PASSWORD,
        mode,
        onConflict,
    });
}

async function withWrongSignerWallet(fileContent) {
    const envelope = parseBackupEnvelope(fileContent);
    const payload = await decodeBackupEnvelope({ password: FILE_PASSWORD, envelope });
    payload.signers[0].walletId = 'another-wallet';
    return stringifyBackupEnvelope(await encodeBackupEnvelope({
        password: FILE_PASSWORD,
        payload,
        walletName: payload.wallet.name,
        kdfParams: fastKdf(),
    }));
}

describe('hardware signer backup records', () => {
    it('restores a resolvable signer link into a fresh vault', async () => {
        const source = await hardwareSource();
        const target = await openVault(5);
        const result = await restore(target, await backup(source));

        const restoredAddress = await target.addresses.get(source.address.id);
        const descriptor = await resolveSigner({ vault: target, address: restoredAddress });
        expect(result.writes.signers).toBe(1);
        expect(descriptor).toMatchObject({ kind: 'ledger', signerRecord: { id: source.signer.id } });
    });

    it('remints the signer and follows it from the hardware address in add mode', async () => {
        const source = await hardwareSource();
        const target = await openVault(6);
        const result = await restore(target, await backup(source), 'add');

        const [restoredSigner] = await target.signers.list();
        const [restoredAddress] = await target.addresses.list();
        expect(restoredSigner).toMatchObject({ walletId: result.walletId, kind: 'ledger' });
        expect(restoredSigner.id).not.toBe(source.signer.id);
        expect(restoredAddress.signerId).toBe(restoredSigner.id);
        await expect(resolveSigner({ vault: target, address: restoredAddress }))
            .resolves.toMatchObject({ signerRecord: { id: restoredSigner.id } });
    });

    it('reuses an existing record id for the same device on fresh restore', async () => {
        const source = await hardwareSource();
        const target = await openVault(8);
        const existingSigner = { ...source.signer, id: 'signer-already-present' };
        await target.putMany([
            { store: target.wallets, record: source.wallet },
            { store: target.signers, record: existingSigner },
        ]);

        const result = await restore(target, await backup(source), 'fresh', 'overwrite');
        const restoredAddress = await target.addresses.get(source.address.id);
        const paired = await registerSigner({
            vault: target,
            walletId: source.wallet.id,
            kind: source.signer.kind,
            vendor: source.signer.vendor,
            model: source.signer.model,
            deviceIdentifier: source.signer.deviceIdentifier,
        });

        expect(result.writes.signers).toBe(0);
        expect(await target.signers.list()).toHaveLength(1);
        expect(restoredAddress.signerId).toBe(existingSigner.id);
        expect(paired.id).toBe(existingSigner.id);
        await expect(resolveSigner({ vault: target, address: restoredAddress }))
            .resolves.toMatchObject({ signerRecord: { id: existingSigner.id } });
    });

    it('rejects a signer from another wallet before writing anything', async () => {
        const source = await hardwareSource();
        const target = await openVault(7);
        const poisoned = await withWrongSignerWallet(await backup(source));

        await expect(restore(target, poisoned)).rejects.toThrow(/signer "signer-source" belongs to another wallet/);
        expect(await target.wallets.list()).toEqual([]);
        expect(await target.signers.list()).toEqual([]);
        expect(await target.addresses.list()).toEqual([]);
    });
});
