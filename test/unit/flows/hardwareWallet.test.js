// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a seedless hardware wallet (format 'hardware'). addHardwareWallet
// saves the wallet, its SignerRecord, accounts and addresses into a real
// Vault (so every record passes the vault's validators), the network table
// answers per vendor, and every seed reader either refuses the wallet with
// HardwareWalletHasNoSeedError or skips it.

import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import {
    addHardwareWallet,
    hardwareNetworkSupport,
    isHardwareWallet,
    HARDWARE_NETWORK_SUPPORT,
    HardwareWalletAlreadyLinkedError,
    HardwareWalletHasNoSeedError,
} from '../../../packages/core/src/flows/hardwareWallet.js';
import { TREZOR_NETWORK_SUPPORT } from '../../../packages/signers-trezor/src/trezorFormat.js';
import { LEDGER_NETWORK_SUPPORT } from '../../../packages/signers-ledger/src/ledgerFormat.js';
import { unlockWallet, unlockWalletRecord, withUnlocked } from '../../../packages/core/src/flows/unlockWallet.js';
import { createAccount } from '../../../packages/core/src/flows/createAccount.js';
import { activateChain } from '../../../packages/core/src/flows/activateChain.js';
import { discoverWalletAddresses } from '../../../packages/core/src/flows/walletAddressDiscovery.js';
import {
    prepareLabelsPublication,
    restoreLabelSyncAfterImport,
} from '../../../packages/core/src/flows/labelSync.js';
import { revealMnemonic } from '../../../packages/core/src/flows/revealMnemonic.js';
import { importWif } from '../../../packages/core/src/flows/importWif.js';
import { dryRunRestore } from '../../../packages/core/src/flows/dryRunRestore.js';
import { exportBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import { ensureNetworkAddresses } from '../../../packages/core/src/flows/ensureNetworkAddresses.js';
import { receiveAddress } from '../../../packages/core/src/flows/receiveAddress.js';
import { dispenserAddress } from '../../../packages/core/src/flows/dispenserAddress.js';
import { signMessageFlow, signPsbtFlow } from '../../../packages/core/src/flows/signFlows.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { SignerPool } from '../../../packages/core/src/signers/SignerPool.js';

const chainRegistry = new ChainRegistry();
const sdkRegistry = { get: () => ({}) };

const TREZOR = {
    vendor: 'trezor', model: 'T2T1', deviceIdentifier: 'trezor-device-1', firmwareVersion: '2.8.1',
};

const entry = (chainId, accountIndex, addressType, n = 0) => ({
    chainId,
    accountIndex,
    address: `${chainId}-acct${accountIndex}-addr${n}`,
    publicKey: `02${String(accountIndex).padStart(2, '0')}${'ab'.repeat(31)}`,
    derivationPath: `m/84'/0'/${accountIndex}'/0/${n}`,
    addressType,
});

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    return vault;
}

async function addTrezorWallet(vault, overrides = {}) {
    return addHardwareWallet({
        vault,
        chainRegistry,
        name: 'My Trezor',
        device: TREZOR,
        accounts: [
            entry('bitcoin-mainnet', 0, 'p2wpkh'),
            entry('litecoin-mainnet', 0, 'p2wpkh'),
            entry('bitcoin-mainnet', 1, 'p2wpkh'),
        ],
        ...overrides,
    });
}

describe('hardwareNetworkSupport (one table, per vendor)', () => {
    it('signs Bitcoin, Litecoin and Dogecoin mainnet on both vendors', () => {
        for (const vendor of ['trezor', 'ledger']) {
            for (const chainId of ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet']) {
                expect(hardwareNetworkSupport(vendor, chainId)).toEqual({ supported: true, reason: null });
            }
        }
    });

    it('gives the vendor reason where the firmware has no coin or app', () => {
        expect(hardwareNetworkSupport('trezor', 'dogecoin-testnet'))
            .toEqual({ supported: false, reason: 'Not supported by Trezor' });
        expect(hardwareNetworkSupport('ledger', 'dogecoin-regtest'))
            .toEqual({ supported: false, reason: 'Not supported by Ledger' });
    });

    // The table as ruled 2026-11-15 (native test derivation at coin type 1'),
    // pinned as literals: a change to either signer package's table has to
    // change this test too, on purpose.
    const RULED = {
        trezor: {
            'bitcoin-mainnet': true,
            'bitcoin-testnet': true,
            'bitcoin-regtest': true,
            'litecoin-mainnet': true,
            'litecoin-testnet': true,
            'litecoin-regtest': false,
            'dogecoin-mainnet': true,
            'dogecoin-testnet': false,
            'dogecoin-regtest': false,
        },
        ledger: {
            'bitcoin-mainnet': true,
            'bitcoin-testnet': true,
            'bitcoin-regtest': true,
            'litecoin-mainnet': true,
            'litecoin-testnet': false,
            'litecoin-regtest': false,
            'dogecoin-mainnet': true,
            'dogecoin-testnet': false,
            'dogecoin-regtest': false,
        },
    };

    it('is the ruled vendor by network table', () => {
        expect(HARDWARE_NETWORK_SUPPORT).toEqual(RULED);
        for (const [vendor, row] of Object.entries(RULED)) {
            for (const [chainId, supported] of Object.entries(row)) {
                expect([vendor, chainId, hardwareNetworkSupport(vendor, chainId).supported])
                    .toEqual([vendor, chainId, supported]);
            }
        }
    });

    it('is built from the signer packages\' own per-network tables, so they cannot drift', () => {
        for (const [vendor, table] of [['trezor', TREZOR_NETWORK_SUPPORT], ['ledger', LEDGER_NETWORK_SUPPORT]]) {
            expect(Object.keys(table).sort()).toEqual(Object.keys(RULED[vendor]).sort());
            for (const [chainId, row] of Object.entries(table)) {
                expect([vendor, chainId, row.supported]).toEqual([vendor, chainId, HARDWARE_NETWORK_SUPPORT[vendor][chainId]]);
                // A refused row names its vendor reason; a supported row has none.
                if (row.supported) expect(row.reason).toBeNull();
                else expect(row.reason).toMatch(/\S/);
            }
        }
    });

    it('refuses unknown chains and vendors', () => {
        expect(hardwareNetworkSupport('ledger', 'kaspa-mainnet'))
            .toEqual({ supported: false, reason: 'Not supported by Ledger' });
        expect(hardwareNetworkSupport('keystone', 'bitcoin-mainnet').supported).toBe(false);
        expect(hardwareNetworkSupport('constructor', 'bitcoin-mainnet').supported).toBe(false);
    });

    it('is exported from flows/index.js with the rest of the contract', async () => {
        // Imported here so the barrel's wide import graph cannot hide the
        // flow tests below behind an unrelated load failure.
        const flows = await import('../../../packages/core/src/flows/index.js');
        expect(flows.addHardwareWallet).toBe(addHardwareWallet);
        expect(flows.isHardwareWallet).toBe(isHardwareWallet);
        expect(flows.hardwareNetworkSupport).toBe(hardwareNetworkSupport);
        expect(flows.HardwareWalletHasNoSeedError).toBe(HardwareWalletHasNoSeedError);
    });
});

describe('addHardwareWallet', () => {
    let vault;
    beforeEach(async () => { vault = await openVault(); });

    it('saves a seedless wallet with its signer, accounts and addresses', async () => {
        const out = await addTrezorWallet(vault);

        expect(out.wallet).toMatchObject({
            format: 'hardware',
            origin: 'connected-hardware',
            encryptedSeed: '',
            importedKeys: [],
            passphraseEnabled: false,
            encryptedPassphrase: null,
            walletMode: 'full',
            name: 'My Trezor',
        });
        expect(isHardwareWallet(out.wallet)).toBe(true);
        expect(out.signer).toMatchObject({
            walletId: out.wallet.id, kind: 'trezor', vendor: 'trezor', model: 'T2T1',
            deviceIdentifier: 'trezor-device-1', firmwareVersion: '2.8.1',
        });
        expect(out.accounts.map((a) => [a.index, a.name])).toEqual([[0, 'Account 1'], [1, 'Account 2']]);
        expect(out.addresses).toHaveLength(3);
        for (const { address } of out.addresses) {
            expect(address.source).toBe('trezor');
            expect(address.signerId).toBe(out.signer.id);
        }

        // Read back through the vault: every record passed its validator.
        expect(await vault.wallets.get(out.wallet.id)).toMatchObject({ format: 'hardware' });
        expect(await vault.signers.get(out.signer.id)).toMatchObject({ walletId: out.wallet.id });
        expect(await vault.accounts.findBy('walletId', out.wallet.id)).toHaveLength(2);
        const stored = await vault.addresses.list();
        expect(stored.map((a) => `${a.chain}/${a.network}/${a.label}`).sort()).toEqual([
            'bitcoin/mainnet/BTC Address #1',
            'bitcoin/mainnet/BTC Address #1',
            'litecoin/mainnet/LTC Address #1',
        ]);
        const acct0 = out.accounts[0];
        expect(stored.filter((a) => a.accountId === acct0.id)).toHaveLength(2);

        // A fresh vault gains a settings record on the wallet's network.
        const settings = await vault.settings.get();
        expect(settings.activeNetwork).toBe('mainnet');
        expect(Object.keys(settings.fees)).toEqual(expect.arrayContaining(['bitcoin-mainnet', 'litecoin-mainnet']));
    });

    it('stores a null firmware version when none is reported', async () => {
        const out = await addTrezorWallet(vault, { device: { ...TREZOR, firmwareVersion: '' } });
        expect(out.signer.firmwareVersion).toBeNull();
    });

    it('accepts testnet accounts and lands a fresh vault on testnet', async () => {
        const out = await addTrezorWallet(vault, {
            name: 'Test Trezor',
            accounts: [entry('bitcoin-testnet', 0, 'p2wpkh'), entry('litecoin-testnet', 0, 'p2wpkh')],
        });
        expect(out.addresses.map(({ address }) => [address.source, address.chain, address.network])).toEqual([
            ['trezor', 'bitcoin', 'testnet'],
            ['trezor', 'litecoin', 'testnet'],
        ]);
        expect((await vault.settings.get()).activeNetwork).toBe('testnet');
    });

    it('refuses a chain the device cannot sign, and writes nothing', async () => {
        await expect(addTrezorWallet(vault, {
            accounts: [entry('bitcoin-mainnet', 0, 'p2wpkh'), entry('dogecoin-testnet', 0, 'p2pkh')],
        })).rejects.toThrow(/Not supported by Trezor/);
        await expect(addHardwareWallet({
            vault,
            chainRegistry,
            name: 'Test Ledger',
            device: { vendor: 'ledger', model: 'nanoX', deviceIdentifier: 'ledger-1', firmwareVersion: null },
            accounts: [entry('litecoin-testnet', 0, 'p2pkh')],
        })).rejects.toThrow(/Not supported by Ledger/);
        expect(await vault.wallets.list()).toEqual([]);
        expect(await vault.signers.list()).toEqual([]);
        expect(await vault.addresses.list()).toEqual([]);
    });

    it('accepts Ledger Bitcoin testnet and regtest accounts at the device\'s own 1\' path', async () => {
        const native = (chainId, address) => ({
            ...entry(chainId, 0, 'p2wpkh'), address, derivationPath: "m/84'/1'/0'/0/0",
        });
        const out = await addHardwareWallet({
            vault,
            chainRegistry,
            name: 'Test Ledger',
            device: { vendor: 'ledger', model: 'nanoX', deviceIdentifier: 'ledger-1', firmwareVersion: null },
            accounts: [
                native('bitcoin-testnet', 'tb1q-device-address'),
                native('bitcoin-regtest', 'bcrt1q-device-address'),
            ],
        });
        // The record holds exactly what the device gave: its address at its path.
        expect(out.addresses.map(({ address }) => [address.source, address.network, address.derivationPath, address.address]))
            .toEqual([
                ['ledger', 'testnet', "m/84'/1'/0'/0/0", 'tb1q-device-address'],
                ['ledger', 'regtest', "m/84'/1'/0'/0/0", 'bcrt1q-device-address'],
            ]);
    });

    it('refuses an address type the chain does not use', async () => {
        await expect(addTrezorWallet(vault, { accounts: [entry('dogecoin-mainnet', 0, 'p2wpkh')] }))
            .rejects.toThrow(/addressType "p2wpkh" is not used on dogecoin-mainnet/);
    });

    it('refuses the same account listed twice on one chain', async () => {
        await expect(addTrezorWallet(vault, {
            accounts: [entry('bitcoin-mainnet', 0, 'p2wpkh'), entry('bitcoin-mainnet', 0, 'p2wpkh', 1)],
        })).rejects.toThrow(/listed twice/);
    });

    it('refuses a name another wallet already has', async () => {
        await addTrezorWallet(vault);
        await expect(addTrezorWallet(vault, {
            device: { ...TREZOR, deviceIdentifier: 'trezor-device-2' }, name: '  my trezor ',
        })).rejects.toThrow('A wallet named "my trezor" already exists.');
    });

    it('refuses a device already connected as a hardware wallet', async () => {
        await addTrezorWallet(vault);
        const err = await addTrezorWallet(vault, { name: 'Again' }).catch((e) => e);
        expect(err).toBeInstanceOf(HardwareWalletAlreadyLinkedError);
        expect(err.code).toBe('HW_ALREADY_LINKED');
        expect(err.message).toBe('This Trezor is already connected as "My Trezor".');
        expect(await vault.wallets.list()).toHaveLength(1);
    });

    it('refuses missing input before touching the vault', async () => {
        await expect(addHardwareWallet({ vault, chainRegistry, name: 'X', device: TREZOR, accounts: [] }))
            .rejects.toThrow(/accounts must be a non-empty array/);
        await expect(addHardwareWallet({
            vault, chainRegistry, name: 'X', device: { ...TREZOR, vendor: 'keystone' }, accounts: [entry('bitcoin-mainnet', 0, 'p2wpkh')],
        })).rejects.toThrow(/device.vendor must be one of/);
        await expect(addHardwareWallet({
            vault, chainRegistry, name: '   ', device: TREZOR, accounts: [entry('bitcoin-mainnet', 0, 'p2wpkh')],
        })).rejects.toThrow(/name must be a non-empty string/);
    });
});

describe('every seed reader refuses or skips a hardware wallet', () => {
    let vault;
    let hw;
    beforeEach(async () => {
        vault = await openVault();
        hw = await addTrezorWallet(vault);
    });

    const isNoSeed = (err) => {
        expect(err).toBeInstanceOf(HardwareWalletHasNoSeedError);
        expect(err.code).toBe('HW_NO_SEED');
        return true;
    };

    it('unlockWalletRecord, unlockWallet and withUnlocked throw the typed error, password or not', async () => {
        isNoSeed(await unlockWalletRecord({ wallet: hw.wallet, chainRegistry, sdkRegistry }).catch((e) => e));
        isNoSeed(await unlockWalletRecord({
            wallet: hw.wallet, password: 'pw-123456', chainRegistry, sdkRegistry,
        }).catch((e) => e));
        isNoSeed(await unlockWallet({
            vault, walletId: hw.wallet.id, password: 'pw-123456', chainRegistry, sdkRegistry,
        }).catch((e) => e));
        let ran = false;
        isNoSeed(await withUnlocked({
            vault, walletId: hw.wallet.id, password: 'pw-123456', chainRegistry, sdkRegistry,
        }, () => { ran = true; }).catch((e) => e));
        expect(ran).toBe(false);
    });

    it('SignerPool.populate lists it as hardware and never unlocks it', async () => {
        const pool = new SignerPool();
        const summary = await pool.populate({ vault, password: 'pw-123456', chainRegistry, sdkRegistry });
        expect(summary.hardware).toEqual([hw.wallet.id]);
        expect(summary.pooled).toEqual([]);
        expect(summary.skipped).toEqual([]);
        expect(pool.has(hw.wallet.id)).toBe(false);
        isNoSeed(await pool.unlockOne({
            wallet: hw.wallet, password: 'pw-123456', chainRegistry, sdkRegistry,
        }).catch((e) => e));
    });

    it('createAccount refuses without the device and derives through it on supported chains', async () => {
        isNoSeed(await createAccount({
            vault, walletId: hw.wallet.id, chainRegistry, sdkRegistry, activeChainIds: ['bitcoin-mainnet'],
        }).catch((e) => e));
        isNoSeed(await createAccount({
            vault, walletId: hw.wallet.id, password: 'pw-123456', chainRegistry, sdkRegistry,
            activeChainIds: ['bitcoin-mainnet'],
        }).catch((e) => e));

        const calls = [];
        const device = {
            id: hw.signer.id,
            kind: 'trezor',
            async getAddresses(params) {
                calls.push(params.chainId);
                return [{ address: `dev-${params.chainId}-${params.accountIndex}`, publicKey: '02'.padEnd(66, 'c'), path: `m/84'/0'/${params.accountIndex}'/0/0` }];
            },
        };
        const out = await createAccount({
            vault, walletId: hw.wallet.id, signer: device, chainRegistry, sdkRegistry,
            activeChainIds: ['bitcoin-mainnet', 'dogecoin-testnet'],
        });
        expect(calls).toEqual(['bitcoin-mainnet']);
        expect(out.account.index).toBe(2);
        expect(out.addresses.map(({ address }) => [address.source, address.signerId]))
            .toEqual([['trezor', hw.signer.id]]);
    });

    it('activateChain seeds the chain but skips the address step without the device', async () => {
        const out = await activateChain({
            vault, walletId: hw.wallet.id, chainId: 'dogecoin-mainnet', chainRegistry, sdkRegistry,
        });
        expect(out).toEqual({
            chainId: 'dogecoin-mainnet', addresses: [], skippedAccounts: 0, skippedAccountDetails: [],
            hardwareSkipped: 'no-device',
        });
        expect((await vault.settings.get()).fees['dogecoin-mainnet']).toBeTruthy();
    });

    it('activateChain skips a chain the device cannot sign and derives one it can', async () => {
        const calls = [];
        const device = {
            id: hw.signer.id,
            kind: 'trezor',
            async getAddresses(params) {
                calls.push(params.chainId);
                return [{ address: `dev-${params.accountIndex}`, publicKey: '02'.padEnd(66, 'd'), path: `m/84'/1'/${params.accountIndex}'/0/0` }];
            },
        };
        const refused = await activateChain({
            vault, walletId: hw.wallet.id, chainId: 'dogecoin-testnet', signer: device, chainRegistry, sdkRegistry,
        });
        expect(refused.hardwareSkipped).toBe('unsupported-network');
        expect(calls).toEqual([]);

        const done = await activateChain({
            vault, walletId: hw.wallet.id, chainId: 'bitcoin-testnet', signer: device, chainRegistry, sdkRegistry,
        });
        expect(done.hardwareSkipped).toBeUndefined();
        expect(done.addresses).toHaveLength(2);
        expect(done.addresses.every(({ address }) => address.source === 'trezor' && address.signerId === hw.signer.id))
            .toBe(true);
    });

    it('address discovery skips it, with or without a signer', async () => {
        expect(await discoverWalletAddresses({
            vault, walletId: hw.wallet.id, chainRegistry, sdkRegistry,
        })).toEqual({ found: 0, chains: [] });
        const device = { id: hw.signer.id, kind: 'trezor', getAddresses: async () => { throw new Error('woke the device'); } };
        expect(await discoverWalletAddresses({
            vault, walletId: hw.wallet.id, signer: device, chainRegistry, sdkRegistry,
        })).toEqual({ found: 0, chains: [] });
    });

    it('a network switch derives nothing for it (no pooled signer)', async () => {
        const out = await ensureNetworkAddresses({
            vault, chainRegistry, sdkRegistry, walletId: hw.wallet.id, network: 'testnet',
        });
        expect(out.skipped).toBe('no-signer');
    });

    it('label sync refuses to publish and skips the restore search', async () => {
        isNoSeed(await prepareLabelsPublication({
            vault, walletId: hw.wallet.id, chainId: 'bitcoin-mainnet', chainRegistry,
        }).catch((e) => e));
        isNoSeed(await prepareLabelsPublication({
            vault, walletId: hw.wallet.id, password: 'pw-123456', chainId: 'bitcoin-mainnet', chainRegistry,
        }).catch((e) => e));
        const restored = await restoreLabelSyncAfterImport({
            vault, walletId: hw.wallet.id, chainIds: ['bitcoin-mainnet'], sdkRegistry,
        });
        expect(restored.skipped).toBe('hardware');
        expect(restored.restored).toBe(false);
    });

    it('phrase, private key, phrase check and backup readers refuse it', async () => {
        isNoSeed(await revealMnemonic({ vault, walletId: hw.wallet.id }).catch((e) => e));
        isNoSeed(await revealMnemonic({ vault, walletId: hw.wallet.id, password: 'pw-123456' }).catch((e) => e));
        isNoSeed(await importWif({
            vault, walletId: hw.wallet.id, chainRegistry, sdkRegistry, chainId: 'bitcoin-mainnet', wif: 'K'.repeat(52),
        }).catch((e) => e));
        isNoSeed(await importWif({
            vault, walletId: hw.wallet.id, password: 'pw-123456', chainRegistry, sdkRegistry,
            chainId: 'bitcoin-mainnet', wif: 'K'.repeat(52),
        }).catch((e) => e));
        isNoSeed(await dryRunRestore({
            vault, walletId: hw.wallet.id, mnemonic: 'abandon '.repeat(11) + 'about', chainRegistry, sdkRegistry,
        }).catch((e) => e));
        isNoSeed(await exportBackupFile({
            vault, walletId: hw.wallet.id, password: 'backup-password-1',
        }).catch((e) => e));
        expect((await vault.wallets.get(hw.wallet.id)).importedKeys).toEqual([]);
    });

    it('address, signing and send flows name the hardware wallet instead of asking for a password', async () => {
        const walletId = hw.wallet.id;
        const common = { vault, walletId, chainRegistry, sdkRegistry, chainId: 'bitcoin-mainnet' };
        const withoutPassword = [
            ['receiveAddress', () => receiveAddress(common)],
            ['dispenserAddress', () => dispenserAddress(common)],
            ['signMessageFlow', () => signMessageFlow({ ...common, path: "m/84'/0'/0'/0/0", message: 'hello' })],
            ['signPsbtFlow', () => signPsbtFlow({
                ...common, psbtHex: '70736274ff', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
            })],
            ['submitAction', () => submitAction({ ...common, actionData: { action: 'SEND' } })],
        ];
        for (const [name, run] of withoutPassword) {
            const err = await run().catch((e) => e);
            expect([name, err?.code]).toEqual([name, 'HW_NO_SEED']);
        }
        // With a password the seed unlock itself refuses.
        const withPassword = [
            ['signMessageFlow', () => signMessageFlow({
                ...common, password: 'pw-123456', path: "m/84'/0'/0'/0/0", message: 'hello',
            })],
            ['signPsbtFlow', () => signPsbtFlow({
                ...common, password: 'pw-123456', psbtHex: '70736274ff',
                signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
            })],
        ];
        for (const [name, run] of withPassword) {
            const err = await run().catch((e) => e);
            expect([name, err?.code]).toEqual([name, 'HW_NO_SEED']);
        }
    });
});
