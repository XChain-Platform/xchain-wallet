// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Messaging inbox flow (§41.7.2). Fetches MESSAGE action history for
// one of the wallet's own addresses and decrypts ECIES-encrypted
// entries in-process using the address's WIF.
//
// Auth model: password required per call. WIF derivation is delegated
// to `exportPrivateKey` (§17.7), same unlock path, same error
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
// This flow is read-only: no vault mutation, no transaction.

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

// Resolve the WIF + address + chainId for one address record, then fetch
// and decrypt its MESSAGE history. Shared by the single-address inbox and
// the per-account sweep. Auth-class failures (wrong password / no key)
// propagate; the callers decide whether to abort.
async function fetchInboxForAddress({
    vault, walletId, password, bip39Passphrase,
    chainRegistry, sdkRegistry, addressId, type, passthroughOpts, injectedSigner,
}) {
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
            vault, walletId, password, bip39Passphrase, chainRegistry, sdkRegistry, addressId,
        }));
    }

    const sdk = sdkRegistry.get(chainId);
    const messages = await sdk.getMessagesForAddress(
        address,
        { ...(passthroughOpts || {}), wif, type },
    );
    return { address, chainId, messages: Array.isArray(messages) ? messages : [] };
}

// Errors that are deterministic across every address in a sweep (the
// password is wrong, the wallet can't derive keys) and so should abort
// the whole sweep rather than be tolerated per-address.
const SWEEP_FATAL_ERRORS = new Set([
    'WrongPasswordError', 'InvalidPasswordError', 'NoKeyForAddressError',
]);

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

    return fetchInboxForAddress({
        vault, walletId, password, bip39Passphrase,
        chainRegistry, sdkRegistry, addressId, type, passthroughOpts, injectedSigner,
    });
}

/**
 * @typedef {Object} GetMessagingInboxSweepResult
 * @property {string[]} addresses          every owner address swept (decrypt succeeded)
 * @property {MessagingInboxMessage[]} messages   merged + de-duped across all addresses
 * @property {Array<{ addressId: string, error: string }>} errors   per-address non-fatal failures
 */

/**
 * Per-account sweep: fetch + decrypt MESSAGE history for every address in
 * the account (the caller passes the address-id list, typically the
 * account's external addresses, dispensers included) and merge the
 * results into one inbox. Messages are
 * de-duped by txid (a self-message addressed between two of the account's
 * own addresses would otherwise appear twice). A per-address transport
 * failure is recorded in `errors` and skipped; an auth-class failure
 * aborts the whole sweep (it would fail identically for every address).
 *
 * @param {Omit<GetMessagingInboxOpts, 'addressId'> & { addressIds: string[] }} opts
 * @returns {Promise<GetMessagingInboxSweepResult>}
 */
export async function getMessagingInboxSweep({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    addressIds,
    type = 'all',
    opts: passthroughOpts,
    signer: injectedSigner,
}) {
    if (!vault) throw new Error('getMessagingInboxSweep: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('getMessagingInboxSweep: walletId is required');
    }
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('getMessagingInboxSweep: either `password` or `signer` is required');
    }
    if (!chainRegistry) throw new Error('getMessagingInboxSweep: chainRegistry is required');
    if (!sdkRegistry) throw new Error('getMessagingInboxSweep: sdkRegistry is required');
    if (!Array.isArray(addressIds) || addressIds.length === 0) {
        throw new Error('getMessagingInboxSweep: addressIds must be a non-empty array');
    }

    const addresses = [];
    const errors = [];
    /** @type {MessagingInboxMessage[]} */
    const merged = [];
    const seenTxids = new Set();

    for (const addressId of addressIds) {
        if (typeof addressId !== 'string' || addressId.length === 0) continue;
        let result;
        try {
            result = await fetchInboxForAddress({
                vault, walletId, password, bip39Passphrase,
                chainRegistry, sdkRegistry, addressId, type, passthroughOpts, injectedSigner,
            });
        } catch (err) {
            if (err && SWEEP_FATAL_ERRORS.has(err.name)) throw err;
            errors.push({ addressId, error: err?.message || String(err) });
            continue;
        }
        addresses.push(result.address);
        for (const msg of result.messages) {
            const txid = msg && msg.txid;
            if (txid) {
                if (seenTxids.has(txid)) continue;
                seenTxids.add(txid);
            }
            merged.push(msg);
        }
    }

    merged.sort((a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0));
    return { addresses, messages: merged, errors };
}
