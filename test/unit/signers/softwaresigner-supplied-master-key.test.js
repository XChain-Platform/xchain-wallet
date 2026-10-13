// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: SoftwareSigner.unlock with an already-derived master key on the
// wif-only path, which never goes through decryptWalletSeed. The signer
// must keep its own copy (zeroed at lock), leave the caller's buffer
// alone, and reject a wrong key exactly as it rejects a wrong password.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { encrypt } from '../../../packages/core/src/crypto/aead.js';
import { bytesToBase64, deriveMasterKey } from '../../../packages/core/src/crypto/kdf.js';

// The wrong-password comparison pays one real Argon2id derivation.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const PASSWORD = 'correct-horse-battery-staple';

// Below the production floor on purpose: what is under test is key
// ownership on the wif-only branch, not Argon2id's cost.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

async function wifOnlySigner(masterKey) {
    // decryptImportedKeys only opens the blob, so any plaintext stands in
    // for the WIF here.
    const wifBytes = new TextEncoder().encode('wif-placeholder');
    const encryptedWif = bytesToBase64(await encrypt(masterKey, wifBytes));
    return new SoftwareSigner({
        id: 'wif-only-test',
        displayName: 'WIF only',
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
}

describe('SoftwareSigner.unlock wif-only with a supplied master key', () => {
    it('keeps its own copy, zeroes it at lock, and leaves the caller buffer intact', async () => {
        const callerKey = deriveMasterKey(PASSWORD, KDF_PARAMS);
        const expected = new Uint8Array(callerKey);
        const signer = await wifOnlySigner(callerKey);

        await signer.unlock({ password: PASSWORD, masterKey: callerKey });
        const signerKey = signer.getMasterKey();
        expect(signerKey).toEqual(expected);
        expect(signerKey).not.toBe(callerKey);

        signer.lock();
        expect(signerKey.every((b) => b === 0)).toBe(true);
        expect(callerKey).toEqual(expected);
        callerKey.fill(0);
        expected.fill(0);
    });

    it('a wrong supplied key fails with the same error as a wrong password', async () => {
        const rightKey = deriveMasterKey(PASSWORD, KDF_PARAMS);
        const signer = await wifOnlySigner(rightKey);
        rightKey.fill(0);

        let passwordError;
        try {
            await signer.unlock({ password: 'wrong password' });
        } catch (e) {
            passwordError = e;
        }
        const wrongKey = new Uint8Array(32).fill(5);
        let keyError;
        try {
            await signer.unlock({ password: PASSWORD, masterKey: wrongKey });
        } catch (e) {
            keyError = e;
        }

        expect(passwordError).toBeInstanceOf(Error);
        expect(keyError.constructor).toBe(passwordError.constructor);
        expect(keyError.name).toBe(passwordError.name);
        expect(keyError.message).toBe(passwordError.message);
        expect(await signer.getStatus()).toBe('locked');
        expect(wrongKey.every((b) => b === 5)).toBe(true);
    });
});
