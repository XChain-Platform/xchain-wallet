// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Wallet E2E session 17 / D-67: importing the same WIF twice appended a
// SECOND Address record for one address, because `createAddress` always
// mints a fresh id and nothing checked the wallet's existing imports.
//
// Harmless while imported keys were invisible (D-63); the moment they became
// visible the duplicate double-counted the address's balance on Home -
// observed live at 1.19996808 BTC for an address holding 0.59998404.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { importWif, DuplicateImportError } from '../../../packages/core/src/flows/importWif.js';
import { importSingleWif } from '../../../packages/core/src/flows/importSingleWif.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { discoverUsedAddresses } from '../../../packages/core/src/flows/discoverUsedAddresses.js';
import { encrypt, bytesToBase64 } from '../../../packages/core/src/crypto/index.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const ADDRESS = 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp';
const WIF = 'cSV3bootstrapWIFvalueNotParsedByTheStub';
// Fixed session master key: importWif accepts one instead of a password,
// which keeps Argon2id out of this suite.
const MASTER_KEY = new Uint8Array(32).fill(7);
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

const DESCRIPTOR = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2pkh',
    addressTypes: ['p2pkh', 'p2wpkh'],
};

const chainRegistry = { get: (id) => (id === DESCRIPTOR.id ? DESCRIPTOR : null) };

const sdkRegistry = {
    get: () => ({
        wallet: {
            importWIF: () => ({ publicKeyHex: '02aa' }),
            deriveAddress: () => ADDRESS,
        },
    }),
};

let vault;

beforeEach(async () => {
    const encryptedSeed = bytesToBase64(await encrypt(MASTER_KEY, new Uint8Array(16).fill(3)));
    vault = {
        wallets: memCollection([
            { id: 'w1', schemaVersion: 1, name: 'Legacy Wallet', encryptedSeed, kdfParams: {}, importedKeys: [] },
            { id: 'w2', schemaVersion: 1, name: 'Other Wallet', encryptedSeed, kdfParams: {}, importedKeys: [] },
        ]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection(),
    };
});

function doImport(walletId = 'w1', label) {
    return importWif({
        vault,
        walletId,
        masterKey: MASTER_KEY,
        chainRegistry,
        sdkRegistry,
        chainId: 'bitcoin-regtest',
        wif: WIF,
        label,
    });
}

describe('D-67: importWif refuses a key the wallet already holds', () => {
    it('imports the key the first time', async () => {
        const res = await doImport();
        expect(res.address.address).toBe(ADDRESS);
        expect(res.wallet.importedKeys).toHaveLength(1);
    });

    it('rejects the second import of the same key', async () => {
        await doImport();
        await expect(doImport()).rejects.toBeInstanceOf(DuplicateImportError);
    });

    it('leaves exactly one address record after a rejected re-import', async () => {
        await doImport();
        await doImport().catch(() => {});
        const rows = (await vault.addresses.list()).filter((a) => a.address === ADDRESS);
        expect(rows).toHaveLength(1);
    });

    it('does not append a second importedKeys entry', async () => {
        await doImport();
        await doImport().catch(() => {});
        const w = await vault.wallets.get('w1');
        expect(w.importedKeys).toHaveLength(1);
    });

    it('names the address in plain language, with no flow name or library internals', async () => {
        // D-52 / D-64: import errors reach the user verbatim.
        await doImport();
        const err = await doImport().catch((e) => e);
        expect(err.message).toContain(ADDRESS);
        expect(err.message).not.toContain('importWif');
    });

    it('still allows the same key in a DIFFERENT wallet', async () => {
        // Separate vault container, separate user intent; the guard is
        // wallet-scoped, matching how imported keys are scoped everywhere else.
        await doImport('w1');
        const res = await doImport('w2');
        expect(res.address.address).toBe(ADDRESS);
    });

    it('imports normally when the wallet holds a DIFFERENT imported key', async () => {
        await doImport();
        const other = {
            ...(await vault.addresses.list())[0],
            id: 'addr-other',
            address: 'mDIFFERENT',
        };
        await vault.addresses.put(other);
        const w = await vault.wallets.get('w1');
        w.importedKeys.push({ addressId: 'addr-other', encryptedWif: 'x', importedAt: '2026-07-27' });
        await vault.wallets.put(w);
        // A second, genuinely new key on the same wallet must still go through.
        const sdk2 = { get: () => ({ wallet: { importWIF: () => ({ publicKeyHex: '02bb' }), deriveAddress: () => 'mTHIRD' } }) };
        const res = await importWif({
            vault, walletId: 'w1', masterKey: MASTER_KEY, chainRegistry,
            sdkRegistry: sdk2, chainId: 'bitcoin-regtest', wif: WIF,
        });
        expect(res.address.address).toBe('mTHIRD');
    });

    it('does not turn a duplicate-check storage failure into a successful import', async () => {
        await doImport();
        vault.addresses.get = async () => { throw new Error('storage unavailable'); };
        await expect(doImport()).rejects.toThrow('storage unavailable');
        expect(await vault.addresses.list()).toHaveLength(1);
        expect((await vault.wallets.get('w1')).importedKeys).toHaveLength(1);
    });

    it('removes the address and restores the wallet when its final write fails', async () => {
        const put = vault.wallets.put;
        vault.wallets.put = async (record) => {
            await put(record);
            if (record.importedKeys.length > 0) throw new Error('wallet save failed');
        };

        await expect(doImport()).rejects.toThrow('wallet save failed');
        expect(await vault.addresses.list()).toEqual([]);
        expect((await vault.wallets.get('w1')).importedKeys).toEqual([]);
    });
});

describe('import flow persistence safety', () => {
    it('removes both new records when a single-WIF address write fails', async () => {
        const singleVault = {
            wallets: memCollection(),
            addresses: memCollection(),
        };
        const put = singleVault.addresses.put;
        let failNextPut = true;
        singleVault.addresses.put = async (record) => {
            await put(record);
            if (failNextPut) {
                failNextPut = false;
                throw new Error('address save failed');
            }
        };

        await expect(importSingleWif({
            vault: singleVault,
            password: 'correct horse battery staple',
            chainRegistry,
            sdkRegistry,
            chainId: 'bitcoin-regtest',
            wif: WIF,
            kdfParams: LOW_COST_KDF_PARAMS,
        })).rejects.toThrow('address save failed');

        expect(await singleVault.wallets.list()).toEqual([]);
        expect(await singleVault.addresses.list()).toEqual([]);
    });

    it('removes mnemonic wallet records when an initial address write fails', async () => {
        const hdVault = new Vault({
            backend: new InMemoryBackend(),
            masterKey: new Uint8Array(32).fill(9),
        });
        await hdVault.open();
        const put = hdVault.addresses.put;
        hdVault.addresses.put = async (record) => {
            await put(record);
            throw new Error('initial address save failed');
        };

        await expect(importMnemonic({
            password: 'correct horse battery staple',
            mnemonic: MNEMONIC,
            vault: hdVault,
            chainRegistry: new ChainRegistry(),
            sdkRegistry: {
                get: () => ({
                    wallet: {
                        deriveAddress: (publicKey, { type }) => `${type}_${publicKey.slice(0, 16)}`,
                    },
                }),
            },
            activeChainIds: ['bitcoin-regtest'],
            kdfParams: LOW_COST_KDF_PARAMS,
        })).rejects.toThrow('initial address save failed');

        expect(await hdVault.wallets.count()).toBe(0);
        expect(await hdVault.accounts.count()).toBe(0);
        expect(await hdVault.addresses.count()).toBe(0);
        expect(await hdVault.settings.get()).toBeNull();
    });
});

describe('discovery control validation', () => {
    const discoveryDeps = {
        mnemonic: MNEMONIC,
        chainRegistry: {},
        sdkRegistry: {},
    };

    it.each([
        ['accountIndex', -1, /accountIndex/],
        ['change', 2, /change/],
        ['startIndex', 1.5, /startIndex/],
        ['perQueryTimeoutMs', 0, /perQueryTimeoutMs/],
        ['chainTimeoutMs', Infinity, /chainTimeoutMs/],
        ['isUsedProbe', null, /isUsedProbe/],
    ])('rejects invalid %s before deriving or scanning', async (field, value, message) => {
        await expect(discoverUsedAddresses({ ...discoveryDeps, [field]: value }))
            .rejects.toThrow(message);
    });

    it('uses the chain deadline to bound a hanging probe', async () => {
        vi.useFakeTimers();
        let markProbeStarted;
        const probeStarted = new Promise((resolve) => { markProbeStarted = resolve; });
        const scan = discoverUsedAddresses({
            mnemonic: MNEMONIC,
            chainRegistry: {
                supportedChains: () => [DESCRIPTOR],
                get: () => DESCRIPTOR,
                derivationPathFor: (_id, _type, _account, _change, index) => (
                    `m/44'/0'/0'/0/${index}`
                ),
            },
            sdkRegistry,
            gapLimit: 1,
            perQueryTimeoutMs: 60_000,
            chainTimeoutMs: 25,
            isUsedProbe: () => {
                markProbeStarted();
                return new Promise(() => {});
            },
        });

        try {
            await probeStarted;
            await vi.advanceTimersByTimeAsync(25);
            const result = await scan;
            expect(result.perChain[0]).toMatchObject({
                incomplete: true,
                scannedCount: 1,
                error: 'chain scan exceeded 25ms',
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
