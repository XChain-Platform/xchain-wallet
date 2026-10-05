// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it, vi } from 'vitest';

import { derive, hdKeyFromSeed } from '../../../packages/core/src/crypto/hd.js';
import { decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { unlockWalletRecord } from '../../../packages/core/src/flows/unlockWallet.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const REG = { chainRegistry: {}, sdkRegistry: {} };
const RECEIVE_PATH = "m/84'/0'/0'/0/0";

const fixture = JSON.parse(
    readFileSync(resolve('test/fixtures/vault/populated-vault.json'), 'utf8'),
);

const { password } = fixture;

async function readFixtureWallet() {
    const vault = new Vault({
        backend: new InMemoryBackend(Uint8Array.from(Buffer.from(fixture.blob, 'base64'))),
        masterKey: new Uint8Array(32).fill(fixture.masterKeyFill),
    });
    await vault.open();
    const wallet = await vault.wallets.get(fixture.walletId);
    vault.close();
    return wallet;
}

describe('integration/vault/populated vault unlock', () => {
    it('unlocks the committed wallet with the fixture password', async () => {
        const wallet = await readFixtureWallet();
        const signer = await unlockWalletRecord({ wallet, password, ...REG });

        expect(await signer.getStatus()).toBe('available');
        signer.lock();
    });

    it('rejects the committed wallet under a wrong password', async () => {
        const wallet = await readFixtureWallet();

        await expect(
            unlockWalletRecord({ wallet, password: 'wrong-password', ...REG }),
        ).rejects.toThrow();
    });

    it('decrypts the seed to the mnemonic that derives the BIP84 receive key', async () => {
        const wallet = await readFixtureWallet();
        const bytes = await decryptWalletSeed({
            password,
            encryptedSeed: wallet.encryptedSeed,
            kdfParams: wallet.kdfParams,
        });
        const mnemonic = new TextDecoder().decode(bytes);
        const root = hdKeyFromSeed(mnemonicToSeedSync(mnemonic));

        expect(derive(root, RECEIVE_PATH).publicKeyHex).toBe(fixture.receivePublicKeyHex);
    });
});
