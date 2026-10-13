// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const walletBlobMocks = vi.hoisted(() => ({
    decryptWalletSeed: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/walletBlob.js', async (importOriginal) => ({
    ...await importOriginal(),
    decryptWalletSeed: walletBlobMocks.decryptWalletSeed,
}));

import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

const CASES = [
    {
        format: 'bip39',
        message: 'SoftwareSigner.unlock: decrypted blob is not a valid BIP39 mnemonic',
    },
    {
        format: 'counterwallet-legacy',
        message: 'SoftwareSigner.unlock: decrypted blob is not a valid Counterwallet mnemonic',
    },
    {
        format: 'future-format',
        message: 'SoftwareSigner.unlock: unsupported wallet format "future-format"',
    },
];

describe('SoftwareSigner.unlock error cleanup', () => {
    let plaintext;
    let sessionMasterKey;

    beforeEach(() => {
        plaintext = new TextEncoder().encode('not a valid mnemonic');
        sessionMasterKey = null;
        walletBlobMocks.decryptWalletSeed.mockReset();
        walletBlobMocks.decryptWalletSeed.mockImplementation(async ({
            masterKey,
            retainMasterKey,
        }) => {
            sessionMasterKey = new Uint8Array(masterKey);
            retainMasterKey(sessionMasterKey);
            return plaintext;
        });
    });

    it.each(CASES)(
        'zeroes signer-owned plaintext and master-key buffers for $format errors',
        async ({ format, message }) => {
            const callerMasterKey = new Uint8Array(32).fill(0x5a);
            const expectedCallerKey = new Uint8Array(callerMasterKey);
            const signer = new SoftwareSigner({
                id: 'cleanup-test',
                displayName: 'Cleanup test',
                chainRegistry: null,
                walletEncryption: {
                    encryptedSeed: 'unused-by-mock',
                    kdfParams: {},
                    format,
                },
            });

            await expect(signer.unlock({
                password: 'password',
                masterKey: callerMasterKey,
            })).rejects.toThrow(message);

            expect(plaintext.every((byte) => byte === 0)).toBe(true);
            expect(sessionMasterKey).not.toBe(callerMasterKey);
            expect(sessionMasterKey.every((byte) => byte === 0)).toBe(true);
            expect(callerMasterKey).toEqual(expectedCallerKey);
            expect(await signer.getStatus()).toBe('locked');
        },
    );
});
