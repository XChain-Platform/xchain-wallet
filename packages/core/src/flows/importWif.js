// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// importWif: §15.5. Add a single imported private key to an existing
// HD wallet. Produces an Address record with source='imported-wif',
// derivationPath=null, accountId=null; stores the encrypted WIF in the
// wallet's `importedKeys` array under the SAME master key that
// protects the seed (so one password unlocks both).
//
// Per §15.5.3 these keys are NOT recoverable from the mnemonic; the
// caller (shell) is responsible for surfacing the backup-implications
// warning before invoking this flow.

import {
    deriveMasterKey,
    encrypt,
    decrypt,
    bytesToBase64,
    base64ToBytes,
} from '../crypto/index.js';
import { createAddress } from '../schemas/address.js';
import { WalletNotFoundError } from './unlockWallet.js';

export class InvalidWifError extends Error {
    constructor(reason) {
        super(`importWif: ${reason}`);
        this.name = 'InvalidWifError';
    }
}

export class WrongPasswordError extends Error {
    constructor() {
        super('importWif: wrong password');
        this.name = 'WrongPasswordError';
    }
}

/**
 * @typedef {Object} ImportWifOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId                                 target HD wallet
 * @property {string} password
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId                                  chain the WIF belongs to
 * @property {string} wif                                      base58check-encoded private key
 * @property {string} [addressType]                            defaults to descriptor.defaultAddressType
 * @property {string} [label]                                  defaults to 'Imported Address'
 */

/**
 * @typedef {Object} ImportWifResult
 * @property {import('../schemas/wallet.js').Wallet} wallet    updated wallet record (with new importedKeys entry)
 * @property {import('../schemas/address.js').Address} address new imported-wif Address record
 */

/**
 * @param {ImportWifOpts} opts
 * @returns {Promise<ImportWifResult>}
 */
export async function importWif({
    vault,
    walletId,
    password,
    chainRegistry,
    sdkRegistry,
    chainId,
    wif,
    addressType,
    label,
}) {
    if (!vault) throw new Error('importWif: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('importWif: walletId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('importWif: password is required');
    }
    if (!chainRegistry) throw new Error('importWif: chainRegistry is required');
    if (!sdkRegistry) throw new Error('importWif: sdkRegistry is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('importWif: chainId is required');
    }
    if (typeof wif !== 'string' || wif.length === 0) {
        throw new Error('importWif: wif is required');
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`importWif: unknown chain "${chainId}"`);
    const type = addressType ?? descriptor.defaultAddressType;
    if (!descriptor.addressTypes.includes(type)) {
        throw new Error(
            `importWif: addressType "${type}" not supported on ${chainId}`,
        );
    }

    const walletRecord = await vault.wallets.get(walletId);
    if (!walletRecord) throw new WalletNotFoundError(walletId);

    // Validate WIF via SDK (checksum + network match) and derive the address
    // before any expensive work; fast failure on bad input.
    const sdk = sdkRegistry.get(chainId);
    let keyInfo;
    try {
        keyInfo = sdk.wallet.importWIF(wif);
    } catch (e) {
        throw new InvalidWifError(e && e.message ? e.message : String(e));
    }
    const derivedAddress = sdk.wallet.deriveAddress(keyInfo.publicKeyHex, {
        type,
    });

    // Derive the master key once; verify password against the seed blob;
    // encrypt the WIF with the same key. Zero the key on exit.
    const masterKey = deriveMasterKey(password, walletRecord.kdfParams);
    let encryptedWif;
    try {
        try {
            await decrypt(masterKey, base64ToBytes(walletRecord.encryptedSeed));
        } catch {
            throw new WrongPasswordError();
        }
        const wifBytes = new TextEncoder().encode(wif);
        try {
            const ct = await encrypt(masterKey, wifBytes);
            encryptedWif = bytesToBase64(ct);
        } finally {
            wifBytes.fill(0);
        }
    } finally {
        masterKey.fill(0);
    }

    // Build and persist the Address record. accountId=null / derivationPath=null
    // per §11.3.3's carve-out for imported-WIF / watch-only entries.
    const addressRecord = createAddress({
        accountId: null,
        chain: descriptor.coin,
        network: descriptor.networkKind,
        source: 'imported-wif',
        addressType: type,
        derivationPath: null,
        address: derivedAddress,
        publicKey: keyInfo.publicKeyHex,
        label: label ?? 'Imported Address',
        signerId: walletRecord.id,
    });
    await vault.addresses.put(addressRecord);

    // Append to Wallet.importedKeys.
    const updatedWallet = {
        ...walletRecord,
        importedKeys: [
            ...walletRecord.importedKeys,
            {
                addressId: addressRecord.id,
                encryptedWif,
                importedAt: new Date().toISOString(),
            },
        ],
    };
    await vault.wallets.put(updatedWallet);

    return { wallet: updatedWallet, address: addressRecord };
}
