// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const walletImportedIds = vi.hoisted(() => vi.fn());
const realImportedIds = vi.hoisted(() => ({ fn: null }));

vi.mock('../../../../packages/core/src/flows/_importedAddressIds.js', async (importOriginal) => {
    const original = await importOriginal();
    realImportedIds.fn = original.importedAddressIdsOfWallet;
    return { ...original, importedAddressIdsOfWallet: walletImportedIds };
});

import {
    buildLabelSyncPayload,
    prepareLabelsPublication,
} from '../../../../packages/core/src/flows/labelSync.js';
import { persistHdWallet } from '../../../../packages/core/src/flows/_persistHdWallet.js';
import { generateBip39Mnemonic } from '../../../../packages/core/src/crypto/mnemonic.js';
import { Vault } from '../../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../../packages/core/src/storage/backend.js';
import { createAddress } from '../../../../packages/core/src/schemas/address.js';

const PASSWORD = 'inventory-test-password';
const KDF_PARAMS = {
    algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2, memory: 8192, parallelism: 1,
};
const chainRegistry = { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) };

async function openVault() {
    const vault = new Vault({
        backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9),
    });
    await vault.open();
    return vault;
}

function address(accountId, source, index, over = {}) {
    return createAddress({
        accountId,
        chain: 'bitcoin',
        network: 'regtest',
        source,
        addressType: 'p2wpkh',
        derivationPath: source === 'imported-wif' ? null : `m/84'/1'/0'/0/${index}`,
        address: `bcrt1q${source}${index}${over.suffix ?? ''}`,
        publicKey: `pub-${source}-${index}${over.suffix ?? ''}`,
        label: over.label,
    });
}

async function walletWithInventory(vault) {
    const created = await persistHdWallet({
        mnemonic: generateBip39Mnemonic(128), format: 'bip39', origin: 'created',
        passphraseEnabled: false, password: PASSWORD, name: 'Inventory', accountName: 'Main',
        kdfParams: KDF_PARAMS, vault, chainRegistry: {}, sdkRegistry: {}, activeChainIds: [],
    });
    const hd0 = address(created.account.id, 'hd', 0);
    const hd1 = address(created.account.id, 'hd', 1);
    const imported = address(null, 'imported-wif', 0, { suffix: 'owned', label: 'Imported' });
    const foreign = address(null, 'imported-wif', 0, { suffix: 'foreign', label: 'Foreign' });
    await vault.addresses.put(hd0);
    await vault.addresses.put(hd1);
    await vault.addresses.put(imported);
    await vault.addresses.put(foreign);
    const wallet = await vault.wallets.get(created.wallet.id);
    wallet.importedKeys.push({
        addressId: imported.id, encryptedWif: 'AA==', importedAt: '2026-01-01T00:00:00.000Z',
    });
    await vault.wallets.put(wallet);
    return { wallet, hd1, imported, foreign };
}

beforeEach(() => {
    walletImportedIds.mockReset().mockImplementation((wallet) => realImportedIds.fn(wallet));
});

describe('label sync address inventory', () => {
    it('uses an imported active address and keeps the fallback HD-only', async () => {
        const vault = await openVault();
        const { wallet, hd1, imported, foreign } = await walletWithInventory(vault);
        const base = {
            vault, walletId: wallet.id, password: PASSWORD,
            chainId: 'bitcoin-regtest', chainRegistry,
        };
        const active = await prepareLabelsPublication({ ...base, activeEntry: { id: imported.id } });
        expect(active.from.id).toBe(imported.id);
        expect(active.encoderOpts.sourceAddress).toBe(imported.address);
        expect(active.encoderOpts.change).toBe(imported.address);
        const activeByAddress = await prepareLabelsPublication({
            ...base, activeEntry: { address: imported.address },
        });
        expect(activeByAddress.from.id).toBe(imported.id);
        const rejected = await prepareLabelsPublication({ ...base, activeEntry: { id: foreign.id } });
        expect(rejected.from.id).toBe(hd1.id);
        const fallback = await prepareLabelsPublication(base);
        expect(fallback.from.id).toBe(hd1.id);
    });

    it('delegates imported label ownership to the shared resolver', async () => {
        const vault = await openVault();
        const { wallet, imported, foreign } = await walletWithInventory(vault);
        walletImportedIds.mockReturnValueOnce(new Set([foreign.id]));
        const result = await buildLabelSyncPayload({
            vault, walletId: wallet.id, seed: new Uint8Array([1, 2, 3]),
        });
        expect(result.body.labels.map((row) => row.id)).toEqual([foreign.id]);
        expect(result.body.labels.map((row) => row.id)).not.toContain(imported.id);
        expect(walletImportedIds).toHaveBeenCalledWith(expect.objectContaining({ id: wallet.id }));
    });

    it('reads the wallet record once so a vanished record cannot drop imported labels', async () => {
        const vault = await openVault();
        const { wallet, imported } = await walletWithInventory(vault);
        const realGet = vault.wallets.get.bind(vault.wallets);
        const get = vi.fn()
            .mockImplementationOnce((id) => realGet(id))
            .mockResolvedValue(null);
        vault.wallets.get = get;
        const result = await buildLabelSyncPayload({
            vault, walletId: wallet.id, seed: new Uint8Array([1]),
        });
        expect(get).toHaveBeenCalledTimes(1);
        expect(result.body.labels.map((row) => row.id)).toContain(imported.id);
    });

    it('tolerates a stored wallet whose importedKeys is missing', async () => {
        const vault = await openVault();
        const { wallet, imported } = await walletWithInventory(vault);
        const realGet = vault.wallets.get.bind(vault.wallets);
        vault.wallets.get = async (id) => ({ ...(await realGet(id)), importedKeys: undefined });
        const result = await buildLabelSyncPayload({
            vault, walletId: wallet.id, seed: new Uint8Array([1]),
        });
        expect(result.body.labels.map((row) => row.id)).not.toContain(imported.id);
    });
});
