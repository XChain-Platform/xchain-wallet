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

import { describe, it, expect, beforeEach } from 'vitest';
import { importWif, DuplicateImportError } from '../../../packages/core/src/flows/importWif.js';
import { encrypt, bytesToBase64 } from '../../../packages/core/src/crypto/index.js';

const ADDRESS = 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp';
const WIF = 'cSV3bootstrapWIFvalueNotParsedByTheStub';
// Fixed session master key: importWif accepts one instead of a password,
// which keeps Argon2id out of this suite.
const MASTER_KEY = new Uint8Array(32).fill(7);

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

    it('fails OPEN when the existing address record cannot be read', async () => {
        // A storage hiccup must not block a legitimate import; the duplicate's
        // only consequence is a display one, and that is defended separately.
        await doImport();
        vault.addresses.get = async () => { throw new Error('storage unavailable'); };
        const res = await doImport();
        expect(res.address.address).toBe(ADDRESS);
    });
});
