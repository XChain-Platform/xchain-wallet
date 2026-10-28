// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A private key imported into an unlocked wallet signs in the same
// session. The pooled signer reads its imported keys from the vault once,
// at unlock, so the import route hands it the new key; without that, a
// send or sweep from the new address fails at Approve with "no imported
// WIF for addressId" until the wallet is locked and unlocked again.

import { describe, it, expect, vi } from 'vitest';

const flow = vi.hoisted(() => ({ importWif: vi.fn() }));

vi.mock('../../../packages/core/src/flows/importWif.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, importWif: flow.importWif };
});

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { encrypt } from '../../../packages/core/src/crypto/aead.js';
import { bytesToBase64, deriveMasterKey } from '../../../packages/core/src/crypto/kdf.js';

const PASSWORD = 'correct-horse-battery-staple';
// Below the production floor on purpose: the KDF cost is not under test.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};
// Any non-empty text stands in for the key: the signer holds bytes and
// never parses them on this path.
const NEW_KEY = 'imported-key-placeholder';

async function unlockedSigner() {
    const masterKey = deriveMasterKey(PASSWORD, KDF_PARAMS);
    const encryptedWif = bytesToBase64(await encrypt(masterKey, new TextEncoder().encode('first-key')));
    const signer = new SoftwareSigner({
        id: 'w1',
        displayName: 'Imported keys',
        chainRegistry: null,
        walletEncryption: {
            encryptedSeed: '',
            kdfParams: KDF_PARAMS,
            passphraseEnabled: false,
            encryptedPassphrase: null,
            format: 'wif-only',
            importedKeys: [{ addressId: 'addr-1', encryptedWif }],
        },
    });
    await signer.unlock({ password: PASSWORD, masterKey });
    return signer;
}

function hostWith(signer) {
    flow.importWif.mockReset().mockResolvedValue({
        wallet: { id: 'w1', name: 'Imported keys' },
        address: { id: 'addr-2', chainId: 'bitcoin-regtest', address: 'bcrt1qexample', source: 'imported-wif' },
    });
    return createBackgroundHost({
        vault: {},
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => signer, has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

describe('wallet.importWif hands the new key to the unlocked session signer', () => {
    it('lets the new address sign without a relock', async () => {
        const signer = await unlockedSigner();
        const host = hostWith(signer);
        expect(() => signer.exportWifForAddressId('addr-2')).toThrow(/no imported WIF/);

        const res = await host.handle({
            type: 'wallet.importWif',
            request: { walletId: 'w1', chainId: 'bitcoin-regtest', wif: NEW_KEY },
        });

        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(flow.importWif).toHaveBeenCalledTimes(1);
        expect(signer.exportWifForAddressId('addr-2')).toBe(NEW_KEY);
        // The keys read at unlock are untouched.
        expect(signer.exportWifForAddressId('addr-1')).toBe('first-key');
    });

    it('keeps the import when the signer locked in between', async () => {
        const signer = await unlockedSigner();
        const host = hostWith(signer);
        signer.lock();

        const res = await host.handle({
            type: 'wallet.importWif',
            request: { walletId: 'w1', chainId: 'bitcoin-regtest', wif: NEW_KEY, password: PASSWORD },
        });

        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result.address.id).toBe('addr-2');
    });
});

describe('SoftwareSigner.addImportedWif', () => {
    it('zeroes a key added in session at lock, like the keys read at unlock', async () => {
        const signer = await unlockedSigner();
        signer.addImportedWif('addr-2', NEW_KEY);
        const held = signer._unlocked.importedWifs.get('addr-2');
        signer.lock();
        expect(Array.from(held).every((b) => b === 0)).toBe(true);
        expect(() => signer.addImportedWif('addr-3', NEW_KEY)).toThrow();
    });

    it('refuses an empty address id or key', async () => {
        const signer = await unlockedSigner();
        expect(() => signer.addImportedWif('', NEW_KEY)).toThrow(/addressId is required/);
        expect(() => signer.addImportedWif('addr-2', '')).toThrow(/wif is required/);
        signer.lock();
    });
});
