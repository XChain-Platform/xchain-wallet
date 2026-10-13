// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Web + mobile half of the onboarding vault-close rule: the in-page create,
// import and fresh-restore lanes close the Vault they built when anything
// before the session starts throws, and leave the page locked. The extension
// and desktop lanes are covered in
// test/unit/background/walletCreateVaultClose.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { populate, flowBehaviour, built } = vi.hoisted(() => ({
    populate: vi.fn(),
    flowBehaviour: {},
    built: [],
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    class FakeSignerPool {
        populate(...args) { return populate(...args); }
        lockAll() { /* nothing pooled */ }
    }
    class InertWatcher {
        async start() { /* no polling in a unit test */ }
        stop() { /* nothing started */ }
        refresh() { return Promise.resolve(); }
    }
    // Keeps a private key copy the way the real Vault does, and zeros it on close.
    class RecordingVault {
        constructor({ masterKey }) {
            this.key = new Uint8Array(masterKey);
            this.closes = 0;
            built.push(this);
        }
        async open() { /* blank document */ }
        async save() { /* accepted */ }
        close() { this.closes += 1; this.key.fill(0); }
    }
    const scripted = (name) => (...args) => flowBehaviour[name](...args);
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            makeFreshKdfParams: () => ({ algorithm: 'argon2id' }),
            deriveMasterKey: () => new Uint8Array(32).fill(9),
        },
        storage: { ...actual.storage, Vault: RecordingVault },
        signers: { ...actual.signers, SignerPool: FakeSignerPool },
        flows: {
            ...actual.flows,
            createWallet: scripted('createWallet'),
            importMnemonic: scripted('importMnemonic'),
            importBackupFile: scripted('importBackupFile'),
            restoreLabelSyncAfterImport: undefined,
        },
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
    createStorageBackend: () => ({ load: async () => null, save: async () => {} }),
    createMetaBackend: () => ({ load: async () => null, save: async () => {} }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const {
    createWalletLocal,
    importMnemonicLocal,
    importBackupLocal,
    lockWalletLocal,
    sendMessage,
} = await import('../../../packages/web/src/hostBridge.js');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const LANES = [
    {
        name: 'createWalletLocal',
        flow: 'createWallet',
        ok: async () => ({ mnemonic: PHRASE, wallet: { id: 'w1', name: 'Main Wallet' } }),
        call: () => createWalletLocal({ password: 'pw' }),
    },
    {
        name: 'importMnemonicLocal',
        flow: 'importMnemonic',
        ok: async () => ({ format: 'bip39', wallet: { id: 'w1', name: 'Imported Wallet' } }),
        call: () => importMnemonicLocal({ password: 'pw', mnemonic: PHRASE }),
    },
    {
        name: 'importBackupLocal',
        flow: 'importBackupFile',
        ok: async () => ({ walletId: 'w1', payload: { wallet: { name: 'Restored' } }, writes: {}, skipped: {}, rekeyed: false }),
        call: () => importBackupLocal({ password: 'pw', backupPassword: 'bp', walletPassword: 'wp', fileContent: '{"x":1}' }),
    },
];

/** The rejection a call to the in-page host raises, or null when it resolved. */
async function hostError() {
    try { await sendMessage('wallet.list'); return null; } catch (err) { return err; }
}

const zeroed = (key) => key.every((b) => b === 0);

beforeEach(async () => {
    await lockWalletLocal();
    built.length = 0;
    populate.mockReset();
    populate.mockResolvedValue({});
    for (const lane of LANES) flowBehaviour[lane.flow] = lane.ok;
});

describe('web onboarding closes its Vault when the session never starts', () => {
    for (const lane of LANES) {
        it(`${lane.name}: a throwing flow zeros the Vault's key copy`, async () => {
            flowBehaviour[lane.flow] = async () => { throw new Error('flow refused'); };
            await expect(lane.call()).rejects.toThrow('flow refused');
            expect(built).toHaveLength(1);
            expect(built[0].closes).toBe(1);
            expect(zeroed(built[0].key)).toBe(true);
            expect((await hostError())?.name).toBe('VaultClosedError');
        });

        it(`${lane.name}: a populate failure after the vault went live leaves the page locked`, async () => {
            populate.mockRejectedValue(new Error('populate failed'));
            await expect(lane.call()).rejects.toThrow('populate failed');
            expect(built).toHaveLength(1);
            expect(built[0].closes).toBe(1);
            expect(zeroed(built[0].key)).toBe(true);
            expect((await hostError())?.name).toBe('VaultClosedError');
            // The module no longer holds that vault, so a lock does not close it twice.
            await lockWalletLocal();
            expect(built[0].closes).toBe(1);
        });

        it(`${lane.name}: the success path leaves the session open`, async () => {
            await lane.call();
            expect(built).toHaveLength(1);
            expect(built[0].closes).toBe(0);
            expect((await hostError())?.name).not.toBe('VaultClosedError');
            await lockWalletLocal();
            expect(built[0].closes).toBe(1);
        });
    }
});
