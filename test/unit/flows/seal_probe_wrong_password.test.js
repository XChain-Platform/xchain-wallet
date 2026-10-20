// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The password probe in importWif and exportPrivateKey calls a failure a wrong
// password only on a real GCM tag mismatch. A damaged seal or a malformed key
// opens under no password, so it must not reach the user as "wrong password".

import { beforeEach, describe, expect, it, vi } from 'vitest';

const kdf = vi.hoisted(() => ({ key: new Uint8Array(32).fill(7) }));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...await importOriginal(),
    deriveMasterKeyAsync: vi.fn(async () => new Uint8Array(kdf.key)),
}));

import { encrypt, bytesToBase64 } from '../../../packages/core/src/crypto/index.js';
import {
    importWif,
    WrongPasswordError as ImportWrongPassword,
} from '../../../packages/core/src/flows/importWif.js';
import {
    exportPrivateKey,
    ImportedKeyDamagedError,
    WrongPasswordError as ExportWrongPassword,
} from '../../../packages/core/src/flows/exportPrivateKey.js';

const RIGHT_KEY = new Uint8Array(32).fill(7);
const WRONG_KEY = new Uint8Array(32).fill(9);
const SHORT_SEAL = bytesToBase64(new Uint8Array(8));

const DESCRIPTOR = {
    id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest',
    defaultAddressType: 'p2pkh', addressTypes: ['p2pkh'],
};
const sdkRegistry = {
    get: () => ({ wallet: { importWIF: () => ({ publicKeyHex: '02ab' }), deriveAddress: () => 'mNEW' } }),
};

let seed;
let wifSeal;
beforeEach(async () => {
    kdf.key = RIGHT_KEY;
    seed = bytesToBase64(await encrypt(RIGHT_KEY, new Uint8Array(16).fill(3)));
    wifSeal = bytesToBase64(await encrypt(RIGHT_KEY, new TextEncoder().encode('cWIF')));
});

function importVault(encryptedSeed) {
    const wallet = { id: 'w1', encryptedSeed, kdfParams: {}, importedKeys: [] };
    return {
        wallets: { get: async () => wallet, put: async () => {} },
        addresses: { list: async () => [], findBy: async () => [], put: async () => {}, delete: async () => {} },
        accounts: { list: async () => [] },
    };
}

function runImport(encryptedSeed, masterKey) {
    return importWif({
        vault: importVault(encryptedSeed), walletId: 'w1', masterKey,
        chainRegistry: { get: () => DESCRIPTOR }, sdkRegistry,
        chainId: DESCRIPTOR.id, wif: 'cWIF',
    });
}

function runExport(wallet) {
    const address = { id: 'a1', source: 'imported-wif', address: 'mOLD', chain: 'bitcoin', network: 'regtest', signerId: 'w1' };
    return exportPrivateKey({
        vault: { addresses: { get: async () => address }, wallets: { get: async () => wallet } },
        walletId: 'w1', password: 'pw', addressId: 'a1',
        chainRegistry: { chainIdFor: () => DESCRIPTOR.id },
    });
}

describe('importWif password probe', () => {
    it('reports a wrong key as a wrong password', async () => {
        await expect(runImport(seed, WRONG_KEY)).rejects.toBeInstanceOf(ImportWrongPassword);
    });

    it('lets a damaged seed seal or a malformed session key through as itself', async () => {
        await expect(runImport(SHORT_SEAL, RIGHT_KEY)).rejects.toThrow('aead: ciphertext too short');
        await expect(runImport('', RIGHT_KEY)).rejects.toThrow('aead: ciphertext too short');
        await expect(runImport(seed, new Uint8Array(16).fill(7)))
            .rejects.toThrow('aead: key must be a 32-byte Uint8Array');
    });
});

describe('exportPrivateKey password probe', () => {
    const entry = (encryptedWif) => [{ addressId: 'a1', encryptedWif }];

    it('reports a wrong password on either probe as a wrong password', async () => {
        kdf.key = WRONG_KEY;
        await expect(runExport({ id: 'w1', format: 'wif-only', kdfParams: {}, importedKeys: entry(wifSeal) }))
            .rejects.toBeInstanceOf(ExportWrongPassword);
        await expect(runExport({ id: 'w1', encryptedSeed: seed, kdfParams: {}, importedKeys: entry(wifSeal) }))
            .rejects.toBeInstanceOf(ExportWrongPassword);
    });

    it('lets a damaged wif or seed seal through as itself', async () => {
        await expect(runExport({ id: 'w1', format: 'wif-only', kdfParams: {}, importedKeys: entry(SHORT_SEAL) }))
            .rejects.toThrow('aead: ciphertext too short');
        await expect(runExport({ id: 'w1', encryptedSeed: SHORT_SEAL, kdfParams: {}, importedKeys: entry(wifSeal) }))
            .rejects.toThrow('aead: ciphertext too short');
    });

    it('reports a key seal that fails after the seed opened as damaged, never a wrong password', async () => {
        const tampered = Uint8Array.from(atob(wifSeal), (c) => c.charCodeAt(0));
        tampered[tampered.length - 1] ^= 1;
        for (const encryptedWif of [bytesToBase64(tampered), SHORT_SEAL]) {
            const err = await runExport({ id: 'w1', encryptedSeed: seed, kdfParams: {}, importedKeys: entry(encryptedWif) })
                .catch((e) => e);
            expect(err).toBeInstanceOf(ImportedKeyDamagedError);
            expect(err.name).toBe('ImportedKeyDamagedError');
        }
        const tagged = await runExport({ id: 'w1', encryptedSeed: seed, kdfParams: {}, importedKeys: entry(bytesToBase64(tampered)) })
            .catch((e) => e);
        expect(tagged.cause?.name).toBe('AeadAuthError');
    });

    it('still opens the key under the right password', async () => {
        const res = await runExport({ id: 'w1', encryptedSeed: seed, kdfParams: {}, importedKeys: entry(wifSeal) });
        expect(res.wif).toBe('cWIF');
    });
});
