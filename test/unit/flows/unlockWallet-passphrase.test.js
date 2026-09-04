// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6 as it now stands: the 25th-word passphrase is captured once, at
// setup, sealed under the wallet's own master key, and read back by the
// signer at every later unlock. The password is the only secret the user
// types after setup.
//
// Two properties carry the whole design, and both are pinned below.
//
//   The stored value ALWAYS wins. Roughly fifty flows still accept an
//   optional `bip39Passphrase`; once a wallet has stored one, every one of
//   those strings is inert. A caller passing a stale value must not derive
//   a different seed under the same wallet, which is exactly the failure
//   behind the earlier unlock-time passphrase fix: it put a user on the
//   wrong addresses.
//
//   A legacy record (passphrase enabled, nothing stored yet) still needs
//   the passphrase typed once. That is the capture path, and the only path
//   that can still raise PassphraseRequiredError.

import { describe, it, expect } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
    unlockWalletRecord,
    PassphraseRequiredError,
    PassphraseMismatchError,
} from '../../../packages/core/src/flows/unlockWallet.js';
import {
    encryptWalletSeed,
    encryptWalletPassphrase,
} from '../../../packages/core/src/crypto/walletBlob.js';
import { deriveMasterKey, makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { hdKeyFromSeed, derive } from '../../../packages/core/src/crypto/hd.js';

const REG = { chainRegistry: {}, sdkRegistry: {} };

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'device-password';
const PASSPHRASE = 'correct horse battery staple';
const STALE_PASSPHRASE = 'the string a careless caller still passes';

// Two account-level nodes plus a receive key. Every address type this
// wallet derives hangs off these, so agreement here is agreement on the
// addresses, without dragging an SDK registry into a flow-level test.
const ACCOUNT_PATH = "m/44'/0'/0'";
const RECEIVE_PATH = "m/84'/0'/0'/0/0";

// Demo-grade cost: this suite pins seed derivation, not the KDF's tuning,
// and the calibrated parameters would put a real Argon2id round on every
// unlock below.
const FAST_KDF = { iterations: 1, memory: 8 * 1024 };

/**
 * Build a persisted Wallet record around the shared mnemonic.
 *
 * @param {Object} opts
 * @param {string|null} [opts.passphrase]  the wallet's real 25th word, or null for a wallet without one
 * @param {boolean} [opts.stored]          true = the passphrase is sealed on the record; false = legacy, awaiting capture
 */
async function makeRecord({ passphrase = null, stored = false, name = 'Cold' } = {}) {
    const kdfParams = makeFreshKdfParams(FAST_KDF);
    const mnemonicBytes = new TextEncoder().encode(MNEMONIC);
    const { encryptedSeed } = await encryptWalletSeed({
        password: PASSWORD,
        seed: mnemonicBytes,
        kdfParams,
    });

    let encryptedPassphrase = null;
    if (stored) {
        const masterKey = deriveMasterKey(PASSWORD, kdfParams);
        try {
            encryptedPassphrase = await encryptWalletPassphrase({ masterKey, passphrase });
        } finally {
            masterKey.fill(0);
        }
    }

    return {
        id: 'w1',
        name,
        format: 'bip39',
        schemaVersion: 3,
        passphraseEnabled: passphrase !== null,
        encryptedSeed,
        kdfParams,
        encryptedPassphrase,
        importedKeys: [],
    };
}

/** The public material an unlocked signer will derive, as a comparable shape. */
async function identityOf(signer) {
    const account = await signer.getAccountXpub({ path: ACCOUNT_PATH });
    const receive = await signer.getPublicKey({ path: RECEIVE_PATH });
    return { account, receive: receive.publicKey };
}

/** The same shape, derived independently from (mnemonic, passphrase). */
function expectedIdentity(passphrase) {
    const root = hdKeyFromSeed(mnemonicToSeedSync(MNEMONIC, passphrase));
    return {
        account: root.derive(ACCOUNT_PATH).publicExtendedKey,
        receive: derive(root, RECEIVE_PATH).publicKeyHex,
    };
}

describe('flows/unlockWallet with a stored 25th-word passphrase', () => {
    it('unlocks a stored-passphrase wallet with the password alone, on the legacy addresses', async () => {
        const stored = await makeRecord({ passphrase: PASSPHRASE, stored: true });
        const signer = await unlockWalletRecord({ wallet: stored, password: PASSWORD, ...REG });
        expect(await signer.getStatus()).toBe('available');

        // The same wallet before capture, unlocked the old way.
        const legacy = await makeRecord({ passphrase: PASSPHRASE, stored: false });
        const legacySigner = await unlockWalletRecord({
            wallet: legacy, password: PASSWORD, bip39Passphrase: PASSPHRASE, ...REG,
        });

        const fromStored = await identityOf(signer);
        expect(fromStored).toEqual(await identityOf(legacySigner));
        expect(fromStored).toEqual(expectedIdentity(PASSPHRASE));

        signer.lock();
        legacySigner.lock();
    });

    it('IGNORES a typed passphrase once one is stored, rather than deriving a different seed', async () => {
        const stored = await makeRecord({ passphrase: PASSPHRASE, stored: true });
        const signer = await unlockWalletRecord({
            wallet: stored, password: PASSWORD, bip39Passphrase: STALE_PASSPHRASE, ...REG,
        });

        const derived = await identityOf(signer);
        expect(derived).toEqual(expectedIdentity(PASSPHRASE));
        // Not merged, not preferred, not compared: the stale string leaves no
        // trace. Pinning the negative too, because the equality above would
        // also hold if both strings happened to derive the same seed.
        expect(derived).not.toEqual(expectedIdentity(STALE_PASSPHRASE));

        signer.lock();
    });

    it('refuses a legacy record with nothing typed, in the sentence the capture step names', async () => {
        const legacy = await makeRecord({ passphrase: PASSPHRASE, stored: false });
        const p = unlockWalletRecord({ wallet: legacy, password: PASSWORD, ...REG });
        await expect(p).rejects.toBeInstanceOf(PassphraseRequiredError);
        await expect(p).rejects.toMatchObject({
            name: 'PassphraseRequiredError',
            code: 'PASSPHRASE_REQUIRED',
            message: 'The wallet "Cold" needs its passphrase entered once more. '
                + 'Lock the wallet; the unlock screen will ask for it.',
        });
    });

    it('treats an empty-string passphrase on a legacy record the same as none', async () => {
        const legacy = await makeRecord({ passphrase: PASSPHRASE, stored: false });
        await expect(unlockWalletRecord({
            wallet: legacy, password: PASSWORD, bip39Passphrase: '', ...REG,
        })).rejects.toBeInstanceOf(PassphraseRequiredError);
    });

    it('unlocks a legacy record when the passphrase is typed, which is how capture reaches a signer', async () => {
        const legacy = await makeRecord({ passphrase: PASSPHRASE, stored: false });
        const signer = await unlockWalletRecord({
            wallet: legacy, password: PASSWORD, bip39Passphrase: PASSPHRASE, ...REG,
        });
        expect(await signer.getStatus()).toBe('available');
        expect(await identityOf(signer)).toEqual(expectedIdentity(PASSPHRASE));
        // Capture seals what this signer holds, so the master key must be here.
        expect(ArrayBuffer.isView(signer.getMasterKey())).toBe(true);
        signer.lock();
    });

    it('leaves a wallet without a passphrase exactly as it was', async () => {
        const plain = await makeRecord({ passphrase: null, name: 'Everyday' });
        expect(plain.passphraseEnabled).toBe(false);
        expect(plain.encryptedPassphrase).toBe(null);

        const signer = await unlockWalletRecord({ wallet: plain, password: PASSWORD, ...REG });
        expect(await signer.getStatus()).toBe('available');
        expect(await identityOf(signer)).toEqual(expectedIdentity(''));
        signer.lock();
    });

    it('fails loudly when the stored blob was not sealed under this wallet', async () => {
        const stored = await makeRecord({ passphrase: PASSPHRASE, stored: true });
        // Same shape, a different wallet's key: a mixed-up or tampered record
        // must not fall back to deriving a passphrase-less seed.
        const other = await makeRecord({ passphrase: PASSPHRASE, stored: true });
        const swapped = { ...stored, encryptedPassphrase: other.encryptedPassphrase };

        await expect(unlockWalletRecord({ wallet: swapped, password: PASSWORD, ...REG }))
            .rejects.toThrow();
    });
});

describe('flows/unlockWallet passphrase error classes', () => {
    it('PassphraseRequiredError points at the unlock screen, not a per-unlock field', () => {
        const msg = new PassphraseRequiredError('Cold').message;
        expect(msg).toContain('"Cold"');
        expect(msg).toMatch(/needs its passphrase entered once more/);
        expect(msg).toMatch(/the unlock screen will ask for it/);
        expect(msg).not.toMatch(/bip39Passphrase|SoftwareSigner/);
        // The old remedy told the user to type it at every unlock.
        expect(msg).not.toMatch(/unlock it again with|passphrase filled in/);
        expect(new PassphraseRequiredError().message).toMatch(/^This wallet needs its passphrase/);
    });

    it('PassphraseMismatchError names the wallets it could not reproduce', () => {
        expect(new PassphraseMismatchError(['Cold']).message).toContain('the wallet "Cold"');
        expect(new PassphraseMismatchError(['A', 'B']).message).toContain('"A", "B"');
        expect(new PassphraseMismatchError([]).message).toContain('your passphrase wallet');
        expect(new PassphraseMismatchError(['Cold']).code).toBe('PASSPHRASE_MISMATCH');
    });
});
