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
import { wifFailureMessage } from './_wifFailureMessage.js';

// D-64: the message is what the user reads, so it is written for them (see
// _wifFailureMessage.js). The library's own text is kept on `.raw` for logs
// and bug reports, never rendered.
export class InvalidWifError extends Error {
    constructor(reason, code) {
        super(wifFailureMessage(reason, code));
        this.name = 'InvalidWifError';
        this.code = code || null;
        this.raw = reason == null ? '' : String(reason);
    }
}

export class WrongPasswordError extends Error {
    constructor() {
        // D-64: user-facing. The old text was 'importWif: wrong password',
        // and this is an error a user causes by mistyping, so it is the one
        // most likely of all of them to be read.
        super('That is not the password for this wallet.');
        this.name = 'WrongPasswordError';
    }
}

// D-67: re-importing a key the wallet already holds used to append a SECOND
// Address record for the same address, because `createAddress` always mints a
// fresh id. Two records for one address then double-counted that address's
// balance everywhere `buildBalanceRows` runs (Home showed 1.19996808 BTC for
// an address holding 0.59998404). Rejecting is deliberate over silently
// re-importing: nothing is mutated, and the user is told why no new row
// appeared. Message is user-facing per D-52/D-64 - no flow name, no library
// internals.
export class DuplicateImportError extends Error {
    constructor(address) {
        super(`This private key is already in this wallet (${address}).`);
        this.name = 'DuplicateImportError';
        this.address = address;
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
    masterKey: sessionMasterKey,
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
    // §15.5 password-less import: an unlocked session may supply the
    // vault master key directly (SoftwareSigner.getMasterKey()) instead
    // of the password. One of the two is required.
    const hasSessionKey = sessionMasterKey instanceof Uint8Array && sessionMasterKey.length > 0;
    if (!hasSessionKey && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('importWif: password or masterKey is required');
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
        throw new InvalidWifError(
            e && e.message ? e.message : String(e),
            e && typeof e.code === 'string' ? e.code : undefined,
        );
    }
    const derivedAddress = sdk.wallet.deriveAddress(keyInfo.publicKeyHex, {
        type,
    });

    // Reject a re-import BEFORE the Argon2id master-key derivation below:
    // D-50's lesson is that a rejection the user can cause by hand must not
    // cost them a 6-8s freeze first.
    await assertNotAlreadyImported(vault, walletRecord, descriptor, derivedAddress);

    // Derive (or take) the master key; verify it against the seed blob;
    // encrypt the WIF with the same key. A derived key is zeroed on exit;
    // a session-supplied key belongs to the signer and is left alone.
    const masterKey = hasSessionKey
        ? sessionMasterKey
        : deriveMasterKey(password, walletRecord.kdfParams);
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
        if (!hasSessionKey) masterKey.fill(0);
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

/**
 * Throw when this wallet already holds an imported key for `address` on this
 * chain. Scoped to the wallet's own `importedKeys`, so the same key may still
 * be imported into a DIFFERENT wallet (a separate vault container, separate
 * user intent), and an HD address that happens to match is left alone - that
 * collision is handled by the address-level dedupe in `buildBalanceRows`,
 * because refusing it here would block a user importing a key they only
 * partially control through the HD tree.
 *
 * Fails OPEN: an unreadable address record cannot prove a duplicate, and
 * blocking a legitimate import on a storage hiccup is the worse outcome -
 * the duplicate's only consequence is a display one, already defended.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {import('../schemas/wallet.js').Wallet} walletRecord
 * @param {{ coin: string, networkKind: string }} descriptor
 * @param {string} address
 */
async function assertNotAlreadyImported(vault, walletRecord, descriptor, address) {
    const keys = Array.isArray(walletRecord.importedKeys) ? walletRecord.importedKeys : [];
    for (const k of keys) {
        if (typeof k?.addressId !== 'string') continue;
        let existing;
        try {
            existing = await vault.addresses.get(k.addressId);
        } catch {
            continue;
        }
        if (!existing) continue;
        if (
            existing.address === address
            && existing.chain === descriptor.coin
            && existing.network === descriptor.networkKind
        ) {
            throw new DuplicateImportError(address);
        }
    }
}
