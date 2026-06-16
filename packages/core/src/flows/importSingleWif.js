// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// importSingleWif — §15.4. Creates a fresh wallet whose only key
// material is a single imported WIF. Wallet.format = 'wif-only';
// encryptedSeed is empty; importedKeys holds the WIF ciphertext.
//
// This is distinct from `importWif` (§15.5), which adds a WIF to an
// existing HD wallet. Here the whole wallet is WIF-only — no mnemonic,
// no HD derivation.
//
// Signing-from-imported-WIF (sendToken / sweepToken on a wif-only
// wallet) is NOT wired by this flow. The current SoftwareSigner.signPsbt
// resolves keys via HD paths only; routing to an importedKey entry is
// a separate gap that affects HD+imported wallets too. For now, a
// wif-only wallet supports: persist, unlock (password validation),
// receive-to, export the WIF. Spending requires that separate gap fix.
//
// Backup implications (§15.5.3) apply doubled: there is NO seed — the
// encrypted backup file (§19.4) is the ONLY recovery path beyond the
// user's own record of the WIF. The shell surfaces this at import time.

import {
    bytesToBase64,
    calibrateKdfParams,
    deriveMasterKey,
    encrypt,
    makeFreshKdfParams,
} from '../crypto/index.js';
import { createAddress } from '../schemas/address.js';
import { createWallet as createWalletRecord } from '../schemas/wallet.js';

export class InvalidWifError extends Error {
    constructor(reason) {
        super(`importSingleWif: ${reason}`);
        this.name = 'InvalidWifError';
    }
}

/**
 * @typedef {Object} ImportSingleWifOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} password                              local encryption password for the new wallet
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId                               chain the WIF belongs to
 * @property {string} wif                                   base58check-encoded private key
 * @property {string} [name]                                defaults to 'Imported Wallet'
 * @property {string} [addressType]                         defaults to descriptor.defaultAddressType
 * @property {string} [label]                               address label; defaults to 'Imported Address'
 * @property {import('../crypto/kdf.js').KdfParams} [kdfParams]   override; otherwise calibrated on this device
 */

/**
 * @typedef {Object} ImportSingleWifResult
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {import('../schemas/address.js').Address} address
 */

/**
 * @param {ImportSingleWifOpts} opts
 * @returns {Promise<ImportSingleWifResult>}
 */
export async function importSingleWif({
    vault,
    password,
    chainRegistry,
    sdkRegistry,
    chainId,
    wif,
    name,
    addressType,
    label,
    kdfParams,
}) {
    if (!vault) throw new Error('importSingleWif: vault is required');
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('importSingleWif: password is required');
    }
    if (!chainRegistry) throw new Error('importSingleWif: chainRegistry is required');
    if (!sdkRegistry) throw new Error('importSingleWif: sdkRegistry is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('importSingleWif: chainId is required');
    }
    if (typeof wif !== 'string' || wif.length === 0) {
        throw new Error('importSingleWif: wif is required');
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`importSingleWif: unknown chain "${chainId}"`);
    const type = addressType ?? descriptor.defaultAddressType;
    if (!descriptor.addressTypes.includes(type)) {
        throw new Error(
            `importSingleWif: addressType "${type}" not supported on ${chainId}`,
        );
    }

    // Validate the WIF and derive the address before spending KDF cost
    // on a call that's guaranteed to fail. Matches `importWif` ordering.
    const sdk = sdkRegistry.get(chainId);
    let keyInfo;
    try {
        keyInfo = sdk.wallet.importWIF(wif);
    } catch (e) {
        throw new InvalidWifError(e && e.message ? e.message : String(e));
    }
    const derivedAddress = sdk.wallet.deriveAddress(keyInfo.publicKeyHex, { type });

    const params = kdfParams ?? (typeof performance !== 'undefined'
        ? calibrateKdfParams({ targetMs: 1000 })
        : makeFreshKdfParams());

    // Encrypt the WIF under the freshly-derived master key. No seed blob
    // to produce — encryptedSeed stays empty.
    const masterKey = deriveMasterKey(password, params);
    let encryptedWif;
    try {
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

    // Build the Wallet record manually so we can set format='wif-only'
    // and an empty encryptedSeed — the schema factory defaults to
    // bip39/non-empty. The shape still matches validateWallet (which
    // has a carve-out for format='wif-only').
    const walletRecord = {
        ...createWalletRecord({
            name: name ?? 'Imported Wallet',
            origin: 'imported-wif',
            format: 'wif-only',
            passphraseEnabled: false,
            encryptedSeed: '',
            kdfParams: params,
        }),
    };

    // Pre-register the address id so the importedKeys link is populated
    // before the Wallet record is written (validateWallet requires at
    // least one importedKeys entry when format='wif-only').
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
    walletRecord.importedKeys = [
        {
            addressId: addressRecord.id,
            encryptedWif,
            importedAt: new Date().toISOString(),
        },
    ];

    await vault.wallets.put(walletRecord);
    await vault.addresses.put(addressRecord);

    return { wallet: walletRecord, address: addressRecord };
}
