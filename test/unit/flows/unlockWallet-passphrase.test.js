// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A §15.6 25th-word wallet that reaches a signing path with only its
// password must fail with a sentence the confirm screen can show as-is.
// Before this, SoftwareSigner's internal "bip39Passphrase is required"
// crossed the messaging boundary verbatim and was what a testnet user saw.

import { describe, it, expect } from 'vitest';
import {
    unlockWalletRecord,
    PassphraseRequiredError,
    PassphraseMismatchError,
} from '../../../packages/core/src/flows/unlockWallet.js';

const REG = { chainRegistry: {}, sdkRegistry: {} };

function passphraseWallet() {
    return {
        id: 'w1',
        name: 'Cold',
        format: 'bip39',
        passphraseEnabled: true,
        encryptedSeed: { ciphertext: '00', iv: '00' },
        kdfParams: {},
        importedKeys: [],
    };
}

describe('flows/unlockWallet 25th-word gate', () => {
    it('refuses a passphrase wallet unlocked with only its password, before any KDF runs', async () => {
        const p = unlockWalletRecord({ wallet: passphraseWallet(), password: 'pw', ...REG });
        await expect(p).rejects.toBeInstanceOf(PassphraseRequiredError);
        await expect(p).rejects.toMatchObject({ name: 'PassphraseRequiredError', code: 'PASSPHRASE_REQUIRED' });
    });

    it('names the wallet and the remedy in plain words', () => {
        const msg = new PassphraseRequiredError('Cold').message;
        expect(msg).toContain('"Cold"');
        expect(msg).toMatch(/25th-word passphrase/);
        expect(msg).toMatch(/unlock it again with the passphrase/);
        expect(msg).not.toMatch(/bip39Passphrase|SoftwareSigner/);
    });

    it('treats an empty-string passphrase the same as none', async () => {
        await expect(unlockWalletRecord({ wallet: passphraseWallet(), password: 'pw', bip39Passphrase: '', ...REG }))
            .rejects.toBeInstanceOf(PassphraseRequiredError);
    });

    it('PassphraseMismatchError names the wallets it could not reproduce', () => {
        expect(new PassphraseMismatchError(['Cold']).message).toContain('the wallet "Cold"');
        expect(new PassphraseMismatchError(['A', 'B']).message).toContain('"A", "B"');
        expect(new PassphraseMismatchError([]).message).toContain('your passphrase wallet');
        expect(new PassphraseMismatchError(['Cold']).code).toBe('PASSPHRASE_MISMATCH');
    });
});
