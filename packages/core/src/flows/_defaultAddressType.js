// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Internal: which address type does THIS wallet default to on a chain?
//
// `descriptor.defaultAddressType` answers that for a BIP39 wallet and
// only for a BIP39 wallet. A `counterwallet-legacy` wallet defaults to
// the address type Counterwallet showed first (p2pkh), because that is
// where a migrating user's balances are.
//
// This lives in one place because the answer is read at nearly a dozen
// call sites - derive, receive, dispenser, activate-chain, new-account,
// network-switch - and a site that disagrees does not merely show the
// wrong address: it looks past the wallet's real addresses entirely and
// reports "no addresses on this chain".

import { COUNTERWALLET_DEFAULT_ADDRESS_TYPE } from '../crypto/index.js';

/**
 * @param {import('../registry/validate.js').ChainDescriptor} descriptor
 * @param {'bip39' | 'counterwallet-legacy' | 'wif-only' | undefined} format
 * @returns {string}
 */
export function defaultAddressTypeForFormat(descriptor, format) {
    if (format === 'counterwallet-legacy') return COUNTERWALLET_DEFAULT_ADDRESS_TYPE;
    return descriptor.defaultAddressType;
}

/**
 * Same, resolved from the persisted Wallet record. A wallet-read error
 * propagates because falling back would silently apply the BIP39 default
 * to a legacy wallet.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} walletId
 * @param {import('../registry/validate.js').ChainDescriptor} descriptor
 * @returns {Promise<string>}
 */
export async function defaultAddressTypeForWallet(vault, walletId, descriptor) {
    const getWallet = vault?.wallets?.get;
    const wallet = walletId && typeof getWallet === 'function'
        ? await getWallet.call(vault.wallets, walletId)
        : null;
    return defaultAddressTypeForFormat(descriptor, wallet?.format);
}
