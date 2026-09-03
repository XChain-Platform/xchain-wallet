// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// unlockWallet: fetch a persisted Wallet record, build a live
// SoftwareSigner against it, and unlock. The symmetric counterpart to
// createWallet (§15.3). Also exposes the lower-level primitive
// `unlockWalletRecord` that other flows reuse when they already hold
// the Wallet record in memory.
//
// Does NOT touch addresses. The caller is responsible for any address
// work after unlocking. Keeping this thin means it's usable from every
// shell that needs a signer.

import { SoftwareSigner } from '../signers/SoftwareSigner.js';

export class WalletNotFoundError extends Error {
    constructor(walletId) {
        super(`unlockWallet: no wallet with id "${walletId}"`);
        this.name = 'WalletNotFoundError';
        this.walletId = walletId;
    }
}

/**
 * A §15.6 25th-word wallet reached a signing path with only its password.
 *
 * The message is written for the user, not the developer, because this is
 * the error a confirm screen shows verbatim: SoftwareSigner's own
 * "bip39Passphrase is required" crossed the messaging boundary untouched
 * and was the first thing a testnet user with a passphrase wallet saw when
 * they tried to sign anything. The remedy it names (unlock again with the
 * passphrase) is the one the unlock screen now offers.
 */
export class PassphraseRequiredError extends Error {
    constructor(walletName) {
        const who = walletName ? `The wallet "${walletName}"` : 'This wallet';
        super(`${who} uses a 25th-word passphrase, so its password alone cannot sign. ` +
              'Lock the wallet, then unlock it again with the passphrase filled in.');
        this.name = 'PassphraseRequiredError';
        this.code = 'PASSPHRASE_REQUIRED';
    }
}

/**
 * The 25th word typed at unlock derived keys that own none of a
 * passphrase wallet's stored addresses. BIP39 accepts every passphrase
 * as a valid seed, so this is the only way a mistyped one can be caught,
 * and the unlock screen shows it on the passphrase field.
 */
export class PassphraseMismatchError extends Error {
    constructor(walletNames = []) {
        const names = walletNames.filter(Boolean);
        const which = names.length === 1
            ? `the wallet "${names[0]}"`
            : names.length > 1 ? `the wallets ${names.map((n) => `"${n}"`).join(', ')}` : 'your passphrase wallet';
        super(`The 25th-word passphrase does not match ${which}. Check it and try again, ` +
              'or leave it blank to unlock without that wallet\'s signer.');
        this.name = 'PassphraseMismatchError';
        this.code = 'PASSPHRASE_MISMATCH';
        this.walletNames = names;
    }
}

/**
 * @typedef {Object} UnlockRecordOpts
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 */

/**
 * Build a SoftwareSigner tied to an already-loaded Wallet record and
 * unlock it. Lower-level primitive for callers with a Wallet record in
 * hand (like `createWallet`) skip the vault lookup.
 *
 * @param {UnlockRecordOpts} opts
 * @returns {Promise<SoftwareSigner>}
 */
export async function unlockWalletRecord({
    wallet,
    password,
    bip39Passphrase = '',
    chainRegistry,
    sdkRegistry,
}) {
    if (!wallet) throw new Error('unlockWalletRecord: wallet is required');
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('unlockWalletRecord: password is required');
    }
    if (!chainRegistry) throw new Error('unlockWalletRecord: chainRegistry is required');
    // Caught here, before the KDF runs, so the user-facing sentence is what
    // reaches the screen instead of the signer's internal precondition.
    if (wallet.passphraseEnabled && (typeof bip39Passphrase !== 'string' || bip39Passphrase.length === 0)) {
        throw new PassphraseRequiredError(wallet.name);
    }

    const signer = new SoftwareSigner({
        id: wallet.id,
        displayName: wallet.name,
        chainRegistry,
        sdkRegistry,
        walletEncryption: {
            encryptedSeed: wallet.encryptedSeed,
            kdfParams: wallet.kdfParams,
            passphraseEnabled: wallet.passphraseEnabled,
            format: wallet.format,
            importedKeys: wallet.importedKeys,
        },
    });

    try {
        await signer.unlock({
            password,
            bip39Passphrase: wallet.passphraseEnabled ? bip39Passphrase : '',
        });
    } catch (e) {
        signer.lock();
        throw e;
    }

    return signer;
}

/**
 * @typedef {Object} UnlockWalletOpts
 * @property {import('../storage/Vault.js').Vault} vault        must be open
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 */

/**
 * Load a Wallet record from the vault and unlock it.
 *
 * @param {UnlockWalletOpts} opts
 * @returns {Promise<SoftwareSigner>}
 */
export async function unlockWallet({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
}) {
    if (!vault) throw new Error('unlockWallet: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('unlockWallet: walletId is required');
    }
    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    return unlockWalletRecord({
        wallet,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });
}

/**
 * Session helper: unlock a wallet, run the callback with the unlocked
 * signer, and always lock on return (success or error). The signer is
 * guaranteed to be locked by the time `withUnlocked` resolves or
 * rejects. No half-unlocked state can leak.
 *
 * Batches multiple signing operations under one unlock, which is important
 * because Argon2id KDF is ~1s per unlock on a typical device. Instead
 * of calling `receiveAddress` three times (three KDF rounds), a shell
 * can call `withUnlocked(opts, async (signer) => { …derive three… })`
 * for one KDF round total.
 *
 * @template T
 * @param {UnlockWalletOpts} unlockOpts
 * @param {(signer: SoftwareSigner) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withUnlocked(unlockOpts, fn) {
    if (typeof fn !== 'function') {
        throw new Error('withUnlocked: fn must be a function');
    }
    const signer = await unlockWallet(unlockOpts);
    try {
        return await fn(signer);
    } finally {
        signer.lock();
    }
}

/**
 * Same as `withUnlocked` but takes an already-loaded Wallet record,
 * skipping the vault lookup. Mirror of `unlockWalletRecord` →
 * `unlockWallet`.
 *
 * @template T
 * @param {UnlockRecordOpts} unlockOpts
 * @param {(signer: SoftwareSigner) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withUnlockedRecord(unlockOpts, fn) {
    if (typeof fn !== 'function') {
        throw new Error('withUnlockedRecord: fn must be a function');
    }
    const signer = await unlockWalletRecord(unlockOpts);
    try {
        return await fn(signer);
    } finally {
        signer.lock();
    }
}
