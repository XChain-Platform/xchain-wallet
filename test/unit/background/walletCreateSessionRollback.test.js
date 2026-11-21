// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A create, import, fresh restore or hardware create that fails after its
// session save opens no session. The rollback drops the session key and the
// cached signing secret with the blob and the kdfParams, as the unlock
// rollback does; otherwise the next host opens over the empty install under a
// key with no kdfParams on record.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@xchain-wallet/core/flows/hardwareWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    addHardwareWallet: async () => ({
        wallet: { id: 'hw1', name: 'My Trezor' }, signer: null, accounts: [], addresses: [],
    }),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            makeFreshKdfParams: () => ({ algorithm: 'argon2id', salt: 'x', memory: 1, iterations: 1, parallelism: 1 }),
            deriveMasterKey: () => new Uint8Array(32).fill(7),
        },
        flows: {
            ...actual.flows,
            createWallet: async () => ({ mnemonic: 'abandon '.repeat(11) + 'about', wallet: { id: 'w1', name: 'Main' } }),
            importMnemonic: async () => ({ format: 'bip39', wallet: { id: 'w1', name: 'Imported' } }),
            importBackupFile: async () => ({ walletId: 'w1', payload: { wallet: { name: 'Restored' } }, writes: {}, skipped: {}, rekeyed: false }),
            restoreLabelSyncAfterImport: undefined,
        },
    };
});

const {
    handleWalletCreateWithMnemonic, handleWalletImport, handleWalletImportBackup, handleWalletCreateHardware,
} = await import('../../../packages/extension/src/background/walletCreate.js');
const core = await import('@xchain-wallet/core');
const chainRegistry = core.registry.defaultRegistry();

const DEVICE = { vendor: 'trezor', model: 'Safe 3', deviceIdentifier: 'dev-1', firmwareVersion: '2.8.1' };
const ACCOUNTS = [{
    chainId: 'bitcoin-mainnet', accountIndex: 0, address: 'bc1qhwexample0', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
}];

const LANES = [
    ['create', (deps) => handleWalletCreateWithMnemonic({ password: 'pw' }, deps)],
    ['import', (deps) => handleWalletImport({ password: 'pw', mnemonic: 'abandon about' }, deps)],
    ['restore', (deps) => handleWalletImportBackup(
        { password: 'pw', backupPassword: 'bp', walletPassword: 'wp', fileContent: '{"x":1}' }, deps)],
    ['hardware', (deps) => handleWalletCreateHardware({ password: 'pw', device: DEVICE, accounts: ACCOUNTS }, deps)],
];

function memoryBackend() {
    let value = null;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        clear: vi.fn(async () => { value = null; }),
        peek: () => value,
    };
}

function makeDeps() {
    return {
        storageBackend: memoryBackend(),
        metaBackend: memoryBackend(),
        sessionBackend: memoryBackend(),
        signingSecretBackend: memoryBackend(),
        chainRegistry,
        sdkRegistry: {},
    };
}

function expectFreshInstall(deps) {
    expect(deps.sessionBackend.peek()).toBeNull();
    expect(deps.signingSecretBackend.peek()).toBeNull();
    expect(deps.storageBackend.peek()).toBeNull();
    expect(deps.metaBackend.peek()).toBeNull();
}

describe('a failed onboarding lane leaves no session behind', () => {
    it.each(LANES)('%s: a refused signing-secret save drops the session key it followed', async (_name, call) => {
        const deps = makeDeps();
        deps.signingSecretBackend.save.mockRejectedValue(new Error('secret store refused'));
        await expect(call(deps)).rejects.toThrow('secret store refused');
        expect(deps.sessionBackend.save).toHaveBeenCalledTimes(1);
        expectFreshInstall(deps);
    });

    it.each(LANES)('%s: a session save that kept the key and then threw leaves the slot empty', async (_name, call) => {
        const deps = makeDeps();
        const keep = deps.sessionBackend.save.getMockImplementation();
        deps.sessionBackend.save.mockImplementation(async (key) => {
            await keep(key);
            throw new Error('session file write refused');
        });
        await expect(call(deps)).rejects.toThrow('session file write refused');
        expectFreshInstall(deps);
    });

    it.each(LANES)('%s: a session clear that fails still reports the original error and clears the rest', async (_name, call) => {
        const deps = makeDeps();
        deps.signingSecretBackend.save.mockRejectedValue(new Error('secret store refused'));
        deps.sessionBackend.clear.mockRejectedValue(new Error('clear refused'));
        await expect(call(deps)).rejects.toThrow('secret store refused');
        expect(deps.signingSecretBackend.clear).toHaveBeenCalledTimes(1);
        expect(deps.storageBackend.peek()).toBeNull();
        expect(deps.metaBackend.peek()).toBeNull();
    });
});
