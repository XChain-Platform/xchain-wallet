// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// createAccount — derive a new BIP44 account under an existing Wallet
// (§11.3.2). Picks the next free `index` (max(existing) + 1), persists
// an Account record, unlocks the wallet to derive a first address per
// active chain, and persists those Address records.
//
// Mirrors the second half of `_persistHdWallet.js` — same address-
// derivation pipeline, no duplicate signer logic.

import { createAccount as createAccountRecord } from '../schemas/account.js';
import { createAddress } from '../schemas/address.js';
import { unlockWalletRecord } from './unlockWallet.js';
import { WalletNotFoundError } from './unlockWallet.js';

/**
 * @typedef {Object} CreateAccountOpts
 * @property {string} walletId
 * @property {string} [password]                         required only when no pre-unlocked signer is supplied (`signer` arg) and the chosen signer is software
 * @property {string} [bip39Passphrase]                  required if the wallet has §15.6 25th-word enabled and no pre-unlocked signer is supplied
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-unlocked SoftwareSigner OR a RemoteSigner for HW. When present, no password is read and the signer is NOT locked by this flow (pool / shell owns its lifecycle)
 * @property {string} [name]                             default `Account N` where N is the new index + 1
 * @property {string} [initialAddressLabel]              default 'Address #1'
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} activeChainIds
 */

/**
 * @typedef {Object} CreateAccountResult
 * @property {import('../schemas/account.js').Account} account
 * @property {Array<{ chainId: string, address: import('../schemas/address.js').Address }>} addresses
 */

/**
 * @param {CreateAccountOpts} opts
 * @returns {Promise<CreateAccountResult>}
 */
export async function createAccount({
    walletId,
    password,
    bip39Passphrase = '',
    signer: providedSigner,
    name,
    initialAddressLabel = 'Address #1',
    vault,
    chainRegistry,
    sdkRegistry,
    activeChainIds,
}) {
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('createAccount: walletId is required');
    }
    if (!providedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('createAccount: either `signer` or `password` is required');
    }
    if (!vault) throw new Error('createAccount: vault is required');
    if (!chainRegistry) throw new Error('createAccount: chainRegistry is required');
    if (!sdkRegistry) throw new Error('createAccount: sdkRegistry is required');
    if (!Array.isArray(activeChainIds) || activeChainIds.length === 0) {
        throw new Error('createAccount: activeChainIds must be a non-empty array');
    }
    for (const id of activeChainIds) {
        if (!chainRegistry.has(id)) {
            throw new Error(`createAccount: unknown chain "${id}"`);
        }
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    // Pick next free index. Indices are dense (0, 1, 2, ...) when
    // accounts are added one at a time, but a future feature could
    // skip indices (e.g., import-account-at-N), so use max+1 rather
    // than count.
    const existing = await vault.accounts.findBy('walletId', walletId);
    const maxIndex = existing.reduce((m, a) => (a.index > m ? a.index : m), -1);
    const nextIndex = maxIndex + 1;

    const account = createAccountRecord({
        walletId,
        name: name || `Account ${nextIndex + 1}`,
        index: nextIndex,
    });
    await vault.accounts.put(account);

    // When the host gives us a pre-unlocked signer (from SignerPool),
    // reuse it and DO NOT lock it — the pool owns its lifecycle. When
    // we have to fall back to a password, build a one-shot signer and
    // lock it before returning.
    const signer = providedSigner
        ? providedSigner
        : await unlockWalletRecord({
            wallet,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
    const ownsSigner = !providedSigner;

    // Pick the right `Address.source` from the signer kind. Software
    // signers produce HD addresses; HW signers produce trezor / ledger
    // addresses tied to the SignerRecord by signerId (§17.6).
    const signerKind = signer.kind;
    const addressSource = signerKind === 'software' ? 'hd' : signerKind;

    try {
        const addresses = [];
        for (const chainId of activeChainIds) {
            const descriptor = chainRegistry.get(chainId);
            const addressType = descriptor.defaultAddressType;
            const [derived] = await signer.getAddresses({
                chainId,
                accountIndex: nextIndex,
                change: 0,
                startIndex: 0,
                count: 1,
                addressType,
            });
            const record = createAddress({
                accountId: account.id,
                chain: descriptor.coin,
                network: descriptor.networkKind,
                source: addressSource,
                addressType,
                derivationPath: derived.path,
                address: derived.address,
                publicKey: derived.publicKey,
                label: initialAddressLabel,
                signerId: signer.id,
            });
            await vault.addresses.put(record);
            addresses.push({ chainId, address: record });
        }
        return { account, addresses };
    } finally {
        if (ownsSigner && typeof signer.lock === 'function') signer.lock();
    }
}
