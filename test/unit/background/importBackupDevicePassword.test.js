// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A restore into an open vault re-seals the backed-up wallet under the box
// labelled "Your password on this device". The host checks that password
// against the key the open vault is sealed under before anything is written,
// so a file or wallet password typed into that box is refused instead of
// landing a wallet that this device's unlock password cannot open.
//
// Real crypto end to end: a real Vault, real backup envelopes, real seals,
// and the real host handlers the three shells share.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { encryptWalletSeed, decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { makeFreshKdfParams, deriveMasterKey } from '../../../packages/core/src/crypto/kdf.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { exportBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import { restoreFailureMessage } from '../../../packages/core/src/flows/restorePasswordCopy.js';
import { createVaultKeyring } from '../../../packages/extension/src/background/vaultKeyring.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const DEVICE = 'device-unlock-password';
const SOURCE_WALLET = 'source-wallet-password';
const FILE = 'backup-file-password';
const MNEMONIC_LIVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_BACKUP = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

async function sealedWalletRecord({ id, mnemonic, password, kdfParams }) {
    const sealed = await encryptWalletSeed({
        password,
        seed: new TextEncoder().encode(mnemonic),
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

async function backupFileContent() {
    const kdfParams = makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: deriveMasterKey(SOURCE_WALLET, kdfParams) });
    await vault.open();
    await vault.wallets.put(await sealedWalletRecord({
        id: 'wallet-from-backup', mnemonic: MNEMONIC_BACKUP, password: SOURCE_WALLET, kdfParams,
    }));
    const { fileContent } = await exportBackupFile({
        vault,
        walletId: 'wallet-from-backup',
        password: FILE,
        kdfParams: makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 }),
    });
    return fileContent;
}

async function openHost() {
    const kdfParams = makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: deriveMasterKey(DEVICE, kdfParams) });
    await vault.open();
    await vault.wallets.put(await sealedWalletRecord({
        id: 'wallet-live', mnemonic: MNEMONIC_LIVE, password: DEVICE, kdfParams,
    }));
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => null, list: () => [], supportedChains: () => [] },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        vaultKeyring: createVaultKeyring({ metaBackend: { load: async () => ({ kdfParams }) } }),
    });
    return { host, vault };
}

const call = (host, type, request) => host.handle({ type, request });

describe('restore into an open vault checks the device password first', () => {
    it.each([
        ['the backup file password', FILE],
        ["the backed-up wallet's own password", SOURCE_WALLET],
    ])('refuses %s in the device box and writes nothing', async (_label, typed) => {
        const fileContent = await backupFileContent();
        const { host, vault } = await openHost();

        const reply = await call(host, 'wallet.importBackup', {
            fileContent,
            password: FILE,
            walletPassword: SOURCE_WALLET,
            devicePassword: typed,
            onConflict: 'error',
            mode: 'add',
        });

        expect(reply.ok).toBe(false);
        expect(reply.error?.message).toContain('Your password on this device');
        // The restore screen keeps naming the device box, not the file or wallet one.
        expect(restoreFailureMessage(reply.error, { mode: 'add' }))
            .toMatch(/^That is not the password this app unlocks with\. The "Your password on this device" field/);
        expect((await vault.wallets.list()).map((w) => w.id)).toEqual(['wallet-live']);
    });

    it('restores under the password the vault opens with, re-sealed so that password opens it', async () => {
        const fileContent = await backupFileContent();
        const { host, vault } = await openHost();

        const reply = await call(host, 'wallet.importBackup', {
            fileContent,
            password: FILE,
            walletPassword: SOURCE_WALLET,
            devicePassword: DEVICE,
            onConflict: 'error',
            mode: 'add',
        });

        expect(reply.ok).toBe(true);
        const restored = await vault.wallets.get(reply.result.walletId);
        const seed = await decryptWalletSeed({
            password: DEVICE,
            encryptedSeed: restored.encryptedSeed,
            kdfParams: restored.kdfParams,
        });
        expect(new TextDecoder().decode(seed)).toBe(MNEMONIC_BACKUP);
    });

    it('refuses the wrong device password on the backup-pointer lane before fetching anything', async () => {
        const { host, vault } = await openHost();
        const fetchSpy = vi.fn(async () => { throw new Error('fetched'); });
        vi.stubGlobal('fetch', fetchSpy);
        try {
            const reply = await call(host, 'wallet.importBackupPointer', {
                pointer: { location: 'https://example.invalid/backup.xchain-wallet' },
                password: FILE,
                walletPassword: SOURCE_WALLET,
                devicePassword: FILE,
                onConflict: 'error',
                mode: 'add',
            });
            expect(reply.ok).toBe(false);
            expect(reply.error?.message).toContain('Your password on this device');
            expect(fetchSpy).not.toHaveBeenCalled();
            expect((await vault.wallets.list()).map((w) => w.id)).toEqual(['wallet-live']);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
