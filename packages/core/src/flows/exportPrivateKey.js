// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// exportPrivateKey — §17.7. Returns the WIF for an address owned by
// this wallet. Parity with FreeWallet: a self-custody wallet that hides
// its own key material from the owner is hiding the thing the user
// fundamentally controls.
//
// Routing by Address.source:
//   - `hd`          derive on-demand from the in-memory seed at the
//                   address's derivation path; never persisted to disk
//                   outside the encrypted seed blob.
//   - `imported-wif` decrypt the matching entry from
//                    `Wallet.importedKeys` under the wallet master key.
//   - `trezor` / `ledger` / `watch-only` — refuse: no key available
//                   in this wallet. The UI surfaces this as an absent
//                   "Show private key" button (§17.7.2); callers that
//                   do invoke the flow get a structured error.
//
// The spec's other guardrails (password-every-time, tap-to-reveal,
// auto-hide on blur, clipboard auto-clear) live in the shell UI — this
// flow is the pure primitive that returns a WIF string.

import {
    base64ToBytes,
    decrypt,
    deriveMasterKey,
} from '../crypto/index.js';
import { unlockWalletRecord, WalletNotFoundError } from './unlockWallet.js';

export class AddressNotFoundError extends Error {
    constructor(addressId) {
        super(`exportPrivateKey: no address with id "${addressId}"`);
        this.name = 'AddressNotFoundError';
        this.addressId = addressId;
    }
}

export class NoKeyForAddressError extends Error {
    /** @param {'watch-only' | 'hardware'} reason */
    constructor(reason) {
        const detail =
            reason === 'hardware'
                ? 'private key lives on the hardware device and is not accessible to the wallet'
                : 'watch-only addresses have no private key in this wallet';
        super(`exportPrivateKey: ${detail}`);
        this.name = 'NoKeyForAddressError';
        this.reason = reason;
    }
}

export class ImportedKeyMissingError extends Error {
    constructor(addressId) {
        super(
            `exportPrivateKey: address "${addressId}" is source=imported-wif but no matching entry in wallet.importedKeys`,
        );
        this.name = 'ImportedKeyMissingError';
        this.addressId = addressId;
    }
}

export class WrongPasswordError extends Error {
    constructor() {
        super('exportPrivateKey: wrong password');
        this.name = 'WrongPasswordError';
    }
}

/**
 * @typedef {Object} ExportPrivateKeyOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]     required iff wallet.passphraseEnabled and address is HD
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} [sdkRegistry]  only needed for HD addresses (unlock path)
 * @property {string} addressId
 */

/**
 * @typedef {Object} ExportPrivateKeyResult
 * @property {string} wif
 * @property {'hd' | 'imported-wif'} source
 * @property {string | null} derivationPath   null for imported-wif
 * @property {string} address
 * @property {string} chainId
 */

/**
 * @param {ExportPrivateKeyOpts} opts
 * @returns {Promise<ExportPrivateKeyResult>}
 */
export async function exportPrivateKey({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    addressId,
}) {
    if (!vault) throw new Error('exportPrivateKey: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('exportPrivateKey: walletId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('exportPrivateKey: password is required');
    }
    if (!chainRegistry) throw new Error('exportPrivateKey: chainRegistry is required');
    if (typeof addressId !== 'string' || addressId.length === 0) {
        throw new Error('exportPrivateKey: addressId is required');
    }

    const addressRecord = await vault.addresses.get(addressId);
    if (!addressRecord) throw new AddressNotFoundError(addressId);

    if (addressRecord.source === 'watch-only') {
        throw new NoKeyForAddressError('watch-only');
    }
    if (addressRecord.source === 'trezor' || addressRecord.source === 'ledger') {
        throw new NoKeyForAddressError('hardware');
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const chainId = chainRegistry.chainIdFor(
        addressRecord.chain,
        addressRecord.network,
    );
    if (!chainId) {
        throw new Error(
            `exportPrivateKey: no registered chain for ${addressRecord.chain}/${addressRecord.network}`,
        );
    }

    if (addressRecord.source === 'imported-wif') {
        const entry = wallet.importedKeys.find((k) => k.addressId === addressId);
        if (!entry) throw new ImportedKeyMissingError(addressId);

        const masterKey = deriveMasterKey(password, wallet.kdfParams);
        try {
            // Password probe. For seed-backed wallets we decrypt the
            // seed blob; for wif-only wallets (no seed) we probe the
            // target importedKey itself — if it decrypts cleanly, the
            // password is correct, and we reuse the decrypted bytes
            // below. Either way a wrong password surfaces as a typed
            // WrongPasswordError instead of a bare AEAD failure.
            let wifBytes;
            if (wallet.format === 'wif-only') {
                try {
                    wifBytes = await decrypt(
                        masterKey,
                        base64ToBytes(entry.encryptedWif),
                    );
                } catch {
                    throw new WrongPasswordError();
                }
            } else {
                try {
                    await decrypt(masterKey, base64ToBytes(wallet.encryptedSeed));
                } catch {
                    throw new WrongPasswordError();
                }
                wifBytes = await decrypt(
                    masterKey,
                    base64ToBytes(entry.encryptedWif),
                );
            }
            try {
                const wif = new TextDecoder().decode(wifBytes);
                return {
                    wif,
                    source: 'imported-wif',
                    derivationPath: null,
                    address: addressRecord.address,
                    chainId,
                };
            } finally {
                wifBytes.fill(0);
            }
        } finally {
            masterKey.fill(0);
        }
    }

    // HD case — unlock the wallet (this is the expensive Argon2id step)
    // and derive a WIF at the address's recorded path.
    if (!addressRecord.derivationPath) {
        throw new Error(
            `exportPrivateKey: HD address "${addressId}" has no derivationPath`,
        );
    }
    const signer = await unlockWalletRecord({
        wallet,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });
    try {
        const wif = signer.exportWifForPath({
            chainId,
            path: addressRecord.derivationPath,
        });
        return {
            wif,
            source: 'hd',
            derivationPath: addressRecord.derivationPath,
            address: addressRecord.address,
            chainId,
        };
    } finally {
        signer.lock();
    }
}
