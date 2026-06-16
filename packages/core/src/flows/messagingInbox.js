// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Messaging inbox flow — §41.7.2. Fetches MESSAGE action history for
// one of the wallet's own addresses and decrypts ECIES-encrypted
// entries in-process using the address's WIF.
//
// Auth model: password required per call. WIF derivation is delegated
// to `exportPrivateKey` (§17.7) — same unlock path, same error
// surface (WrongPasswordError / NoKeyForAddressError / …). Once we
// have the WIF we hand it to the SDK's `getMessagesForAddress`, which
// auto-decrypts ECIES (method 1) entries.
//
// ECDH (method 2) and AES (method 3) require a shared secret the SDK
// can't resolve from a raw WIF alone; those entries come back with
// `text: null` + `encrypted: true` and the UI surfaces them as
// "Encrypted (session key required)". Phase 3 scope is 1:1 ECIES
// (per spec §41.7.1); ECDH/AES will surface more richly once a
// session-store lands.
//
// This flow is read-only — no vault mutation, no transaction.

import { exportPrivateKey } from './exportPrivateKey.js';

/**
 * @typedef {Object} GetMessagingInboxOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]    required iff wallet.passphraseEnabled and address is HD
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} addressId            Address record id (the inbox's owner)
 * @property {'all' | 'sent' | 'received'} [type]  default 'all'
 * @property {object} [opts]                       passthrough pagination opts
 */

/**
 * @typedef {Object} MessagingInboxMessage
 * @property {string | null} from
 * @property {string | null} to
 * @property {string | null} coin
 * @property {string | null} chain
 * @property {string | null} text          decrypted plaintext, or null when encrypted
 * @property {boolean} encrypted           true iff the on-chain entry was encrypted
 * @property {number | null} method        1=ECIES, 2=ECDH, 3=AES
 * @property {string | null} txid
 * @property {number | null} block
 * @property {number | null} timestamp
 */

/**
 * @typedef {Object} GetMessagingInboxResult
 * @property {string} address              the inbox owner's address (echoes input)
 * @property {string} chainId
 * @property {MessagingInboxMessage[]} messages
 */

/**
 * @param {GetMessagingInboxOpts} opts
 * @returns {Promise<GetMessagingInboxResult>}
 */
export async function getMessagingInbox({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    addressId,
    type = 'all',
    opts: passthroughOpts,
    signer: injectedSigner,
}) {
    if (!vault) throw new Error('getMessagingInbox: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('getMessagingInbox: walletId is required');
    }
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('getMessagingInbox: either `password` or `signer` is required');
    }
    if (!chainRegistry) throw new Error('getMessagingInbox: chainRegistry is required');
    if (!sdkRegistry) throw new Error('getMessagingInbox: sdkRegistry is required');
    if (typeof addressId !== 'string' || addressId.length === 0) {
        throw new Error('getMessagingInbox: addressId is required');
    }

    // Unlocked session: derive the address WIF straight from the pooled
    // SoftwareSigner (no password / no Argon2id). Falls back to the
    // password-gated exportPrivateKey when no signer was supplied.
    let wif; let address; let chainId;
    if (injectedSigner) {
        const addressRecord = await vault.addresses.get(addressId);
        if (!addressRecord) throw new Error(`getMessagingInbox: address "${addressId}" not found`);
        chainId = chainRegistry.chainIdFor(addressRecord.chain, addressRecord.network);
        if (!chainId) {
            throw new Error(
                `getMessagingInbox: no registered chain for ${addressRecord.chain}/${addressRecord.network}`,
            );
        }
        address = addressRecord.address;
        wif = addressRecord.source === 'imported-wif'
            ? injectedSigner.exportWifForAddressId(addressId)
            : injectedSigner.exportWifForPath({ chainId, path: addressRecord.derivationPath });
    } else {
        ({ wif, address, chainId } = await exportPrivateKey({
            vault,
            walletId,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
            addressId,
        }));
    }

    const sdk = sdkRegistry.get(chainId);
    const messages = await sdk.getMessagesForAddress(
        address,
        {
            ...(passthroughOpts || {}),
            wif,
            type,
        },
    );

    return {
        address,
        chainId,
        messages: Array.isArray(messages) ? messages : [],
    };
}
