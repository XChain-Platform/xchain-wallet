// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §19.5.2 restore half: `restoreLabelSyncAfterImport` runs inside every
// import lane and brings a seed's published labels + contacts back into
// the fresh vault. The publish half shipped alone and a tester who
// re-imported after a browser purge found every contact gone, so these
// pin the properties the import lanes now depend on:
//
//   - a payload published under THIS seed's discovery name is found on any
//     of the searched chains and written into the vault;
//   - when two chains answer, the payload with the newest updatedAt wins;
//   - an explorer that throws costs that chain only, never the import
//     (errors are reported, not thrown), and a chain with no FILE reads is
//     skipped silently;
//   - a wif-only wallet has no seed and is reported as skipped;
//   - the seed-derived commitment key is zeroed before the flow returns.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { restoreLabelSyncAfterImport, labelSyncSearchChainIds } from '../../../packages/core/src/flows/labelSync.js';
import { persistHdWallet } from '../../../packages/core/src/flows/_persistHdWallet.js';
import { generateBip39Mnemonic, bip39MnemonicToSeed } from '../../../packages/core/src/crypto/mnemonic.js';
import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    encodeLabelSyncPayload,
} from '../../../packages/core/src/crypto/labelSync.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const PASSWORD = 'correct-horse-battery-staple';

const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    return vault;
}

async function makeWallet(vault, { format = 'bip39', bip39Passphrase = '' } = {}) {
    const mnemonic = generateBip39Mnemonic(128);
    const { wallet } = await persistHdWallet({
        mnemonic,
        format,
        origin: 'imported-mnemonic',
        passphraseEnabled: bip39Passphrase.length > 0,
        bip39Passphrase,
        password: PASSWORD,
        name: 'Restored Wallet',
        accountName: 'Main',
        kdfParams: LOW_COST_KDF_PARAMS,
        vault,
        chainRegistry: {},
        sdkRegistry: {},
        activeChainIds: [],
    });
    return { wallet, mnemonic };
}

async function seedFor(mnemonic, passphrase = '') {
    return bip39MnemonicToSeed(mnemonic, passphrase);
}

async function publishedUnder(seed, body) {
    const key = computeLabelSyncCommitmentKey(seed);
    try {
        return {
            name: computeLabelSyncDiscoveryName(key),
            ciphertext: await encodeLabelSyncPayload(key, body),
        };
    } finally {
        key.fill(0);
    }
}

function contact(id, name, address) {
    return { id, name, notes: '', entries: [{ chain: 'bitcoin', address, label: '' }] };
}

function bodyWith({ updatedAt = '2026-09-01T00:00:00.000Z', contacts = [], labels = [] } = {}) {
    return { version: 1, updatedAt, labels, contacts };
}

function fileRow(actionIndex, name) {
    return {
        action: 'FILE',
        action_index: actionIndex,
        name,
        title: 'wallet-labels',
        type: 'application/octet-stream',
        block_index: 600000 + Number(actionIndex),
        status: 'valid',
    };
}

/** An explorer-backed SDK for one chain: `rows` answers getFiles, `raws` the /raw read. */
function fakeSdk({ rows = [], raws = {}, getFilesError = null } = {}) {
    return {
        getFiles: vi.fn(async () => {
            if (getFilesError) throw getFilesError;
            return rows;
        }),
        getGatedFileRaw: vi.fn(async (actionIndex) => {
            const hit = raws[String(actionIndex)];
            if (hit === undefined) throw new Error('404 Not found');
            return hit;
        }),
    };
}

function registryOf(sdks) {
    return {
        get: vi.fn((chainId) => {
            if (!(chainId in sdks)) throw new Error(`unknown chain ${chainId}`);
            return sdks[chainId];
        }),
    };
}

describe('restoreLabelSyncAfterImport', () => {
    it('finds the payload published under this seed and writes its contacts into the fresh vault', async () => {
        const vault = await openVault();
        const { wallet, mnemonic } = await makeWallet(vault);
        const seed = await seedFor(mnemonic);
        const { name, ciphertext } = await publishedUnder(seed, bodyWith({
            contacts: [contact('c-1', 'Alice', 'bc1qalice'), contact('c-2', 'Bob', 'bc1qbob')],
        }));
        seed.fill(0);

        const sdkRegistry = registryOf({
            'bitcoin-mainnet': fakeSdk({ rows: [fileRow('7', name)], raws: { 7: ciphertext } }),
        });

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet'],
            sdkRegistry,
        });

        expect(r.restored).toBe(true);
        expect(r.chainId).toBe('bitcoin-mainnet');
        expect(r.contactsAdded).toBe(2);
        expect(r.errors).toEqual([]);
        expect(r.searchedChainIds).toEqual(['bitcoin-mainnet']);

        const names = (await vault.contacts.list()).map((c) => c.name).sort();
        expect(names).toEqual(['Alice', 'Bob']);
    });

    it('returns restored:false and touches nothing when the seed never published', async () => {
        const vault = await openVault();
        const { wallet } = await makeWallet(vault);
        const sdkRegistry = registryOf({
            'bitcoin-mainnet': fakeSdk({ rows: [] }),
            'litecoin-mainnet': fakeSdk({ rows: [] }),
        });

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet'],
            sdkRegistry,
        });

        expect(r.restored).toBe(false);
        expect(r.skipped).toBeNull();
        expect(r.searchedChainIds).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
        expect(await vault.contacts.list()).toEqual([]);
    });

    it('searches every chain and applies the payload with the newest updatedAt', async () => {
        const vault = await openVault();
        const { wallet, mnemonic } = await makeWallet(vault);
        const seed = await seedFor(mnemonic);
        const older = await publishedUnder(seed, bodyWith({
            updatedAt: '2026-08-01T00:00:00.000Z',
            contacts: [contact('c-1', 'Alice (old)', 'bc1qalice')],
        }));
        const newer = await publishedUnder(seed, bodyWith({
            updatedAt: '2026-09-01T00:00:00.000Z',
            contacts: [contact('c-1', 'Alice', 'bc1qalice'), contact('c-3', 'Carol', 'bc1qcarol')],
        }));
        seed.fill(0);

        // The newer publish sits on the chain searched SECOND, so "first hit
        // wins" would restore the stale book.
        const sdkRegistry = registryOf({
            'bitcoin-mainnet': fakeSdk({ rows: [fileRow('1', older.name)], raws: { 1: older.ciphertext } }),
            'litecoin-mainnet': fakeSdk({ rows: [fileRow('2', newer.name)], raws: { 2: newer.ciphertext } }),
        });

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet'],
            sdkRegistry,
        });

        expect(r.restored).toBe(true);
        expect(r.chainId).toBe('litecoin-mainnet');
        expect(r.updatedAt).toBe('2026-09-01T00:00:00.000Z');
        const names = (await vault.contacts.list()).map((c) => c.name).sort();
        expect(names).toEqual(['Alice', 'Carol']);
    });

    it('reports an explorer failure per chain and still restores from a chain that answered', async () => {
        const vault = await openVault();
        const { wallet, mnemonic } = await makeWallet(vault);
        const seed = await seedFor(mnemonic);
        const { name, ciphertext } = await publishedUnder(seed, bodyWith({
            contacts: [contact('c-1', 'Alice', 'bc1qalice')],
        }));
        seed.fill(0);

        const sdkRegistry = registryOf({
            'bitcoin-mainnet': fakeSdk({ getFilesError: new Error('explorer unreachable') }),
            'litecoin-mainnet': fakeSdk({ rows: [fileRow('9', name)], raws: { 9: ciphertext } }),
        });

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet'],
            sdkRegistry,
        });

        expect(r.restored).toBe(true);
        expect(r.chainId).toBe('litecoin-mainnet');
        expect(r.errors).toEqual([{ chainId: 'bitcoin-mainnet', message: 'explorer unreachable' }]);
        expect((await vault.contacts.list()).map((c) => c.name)).toEqual(['Alice']);
    });

    it('skips a chain the registry cannot build or whose SDK lacks the FILE reads, without throwing', async () => {
        const vault = await openVault();
        const { wallet } = await makeWallet(vault);
        const sdkRegistry = registryOf({
            'dogecoin-mainnet': { getFiles: vi.fn(async () => []) },   // no getGatedFileRaw
        });

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet', 'dogecoin-mainnet', 'dogecoin-mainnet'],
            sdkRegistry,
        });

        expect(r.restored).toBe(false);
        expect(r.searchedChainIds).toEqual([]);
        expect(r.errors).toEqual([]);
    });

    it('reports a wif-only wallet as skipped: there is no seed to derive the discovery name from', async () => {
        // The flow reads the wallet record and stops; a minimal vault is
        // enough and keeps the wif-only schema's key material out of here.
        const vault = {
            wallets: { get: async (id) => (id === 'wif-1' ? { id, format: 'wif-only' } : null) },
            contacts: { list: async () => [] },
            addresses: { list: async () => [] },
        };
        const sdkRegistry = registryOf({ 'bitcoin-mainnet': fakeSdk({ rows: [] }) });

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: 'wif-1',
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet'],
            sdkRegistry,
        });

        expect(r).toMatchObject({ restored: false, skipped: 'wif-only', searchedChainIds: [] });
        expect(sdkRegistry.get).not.toHaveBeenCalled();
    });

    it('reports an empty chain list as skipped', async () => {
        const vault = await openVault();
        const { wallet } = await makeWallet(vault);
        const sdkRegistry = registryOf({});

        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: [],
            sdkRegistry,
        });

        expect(r).toMatchObject({ restored: false, skipped: 'no-chains' });
        expect(sdkRegistry.get).not.toHaveBeenCalled();
    });

    it('derives the discovery name from the STORED passphrase, so a 25th-word wallet finds its own payload', async () => {
        const vault = await openVault();
        const { wallet, mnemonic } = await makeWallet(vault, { bip39Passphrase: 'twenty-fifth-word' });
        const seed = await seedFor(mnemonic, 'twenty-fifth-word');
        const { name, ciphertext } = await publishedUnder(seed, bodyWith({
            contacts: [contact('c-1', 'Alice', 'bc1qalice')],
        }));
        seed.fill(0);
        const sdkRegistry = registryOf({
            'bitcoin-mainnet': fakeSdk({ rows: [fileRow('3', name)], raws: { 3: ciphertext } }),
        });

        // The caller passes NO passphrase: the wallet record carries it.
        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet'],
            sdkRegistry,
        });

        expect(r.restored).toBe(true);
        expect(r.contactsAdded).toBe(1);
    });

    it('gives up on a chain whose explorer never answers, within the per-chain budget, and still restores from the other', async () => {
        const vault = await openVault();
        const { wallet, mnemonic } = await makeWallet(vault);
        const seed = await seedFor(mnemonic);
        const { name, ciphertext } = await publishedUnder(seed, bodyWith({
            contacts: [contact('c-1', 'Alice', 'bc1qalice')],
        }));
        seed.fill(0);

        const hung = {
            getFiles: vi.fn(() => new Promise(() => {})),
            getGatedFileRaw: vi.fn(async () => { throw new Error('unreachable'); }),
        };
        const sdkRegistry = registryOf({
            'bitcoin-mainnet': hung,
            'litecoin-regtest': fakeSdk({ rows: [fileRow('4', name)], raws: { 4: ciphertext } }),
        });

        const started = Date.now();
        const r = await restoreLabelSyncAfterImport({
            vault,
            walletId: wallet.id,
            password: PASSWORD,
            chainIds: ['bitcoin-mainnet', 'litecoin-regtest'],
            sdkRegistry,
            perChainTimeoutMs: 200,
        });

        expect(r.restored).toBe(true);
        expect(r.chainId).toBe('litecoin-regtest');
        expect(r.errors).toEqual([{ chainId: 'bitcoin-mainnet', message: 'explorer did not answer within 0s' }]);
        // Concurrent, so the hung chain cost one budget and nothing more.
        expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('rejects a missing password before touching the vault', async () => {
        const vault = await openVault();
        await expect(restoreLabelSyncAfterImport({
            vault,
            walletId: 'w',
            password: '',
            chainIds: ['bitcoin-mainnet'],
            sdkRegistry: registryOf({}),
        })).rejects.toThrow('password is required');
    });
});

describe('labelSyncSearchChainIds', () => {
    const registry = {
        supportedChains: () => [
            { id: 'bitcoin-mainnet' }, { id: 'litecoin-mainnet' }, { id: 'dogecoin-mainnet' },
            { id: 'bitcoin-testnet' }, { id: 'litecoin-regtest' },
        ],
    };

    it('puts the active chains first and then every chain the registry knows, once each', () => {
        expect(labelSyncSearchChainIds(registry, ['litecoin-mainnet', 'bitcoin-mainnet'])).toEqual([
            'litecoin-mainnet', 'bitcoin-mainnet', 'dogecoin-mainnet', 'bitcoin-testnet', 'litecoin-regtest',
        ]);
    });

    it('survives a registry that cannot list, and drops junk ids', () => {
        expect(labelSyncSearchChainIds(null, ['bitcoin-mainnet', '', null, 'bitcoin-mainnet'])).toEqual(['bitcoin-mainnet']);
        expect(labelSyncSearchChainIds({ supportedChains: () => { throw new Error('no'); } }, ['x'])).toEqual(['x']);
    });
});
