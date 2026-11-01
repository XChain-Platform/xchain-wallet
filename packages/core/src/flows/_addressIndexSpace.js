// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Internal: does THIS wallet allocate one address index per address
// type, or one index shared across all of them?
//
// A BIP39 wallet gets a separate index space per type, because each type
// lives on its own BIP44 branch (m/44'/…, m/49'/…, m/84'/…). Index 0
// under p2wpkh is a different key from index 0 under p2pkh, so allocating
// them independently is correct.
//
// A `counterwallet-legacy` wallet has no such branch: registry
// `derivationPathFor` returns m/0'/C/I for every type, so the type is
// only an ENCODING of the key at that index. Allocating per type there
// hands out an address that re-uses a key the wallet already holds, and
// it disagrees with the wallet the user is migrating from - Counterwallet
// counts one index space across both, which is why a real Counterwallet's
// "first segwit" address is index 1, not index 0 (verified against a real
// server wallet and pinned in test/unit/crypto/counterwallet-interop.test.js).
//
// See also ./_defaultAddressType.js, the other place a legacy wallet's
// derivation differs from a BIP39 one's.

/**
 * @param {'bip39' | 'counterwallet-legacy' | 'wif-only' | undefined} format
 * @returns {boolean} true when every address type shares ONE index space
 */
export function indexSpaceSharedAcrossTypes(format) {
    return format === 'counterwallet-legacy';
}

/**
 * Same, resolved from the persisted Wallet record. A read error propagates
 * because guessing per-type spaces can re-issue a legacy wallet's held key
 * under another address encoding.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} walletId
 * @returns {Promise<boolean>}
 */
export async function indexSpaceSharedForWallet(vault, walletId) {
    if (!walletId || typeof vault?.wallets?.get !== 'function') return false;
    const wallet = await vault.wallets.get(walletId);
    return indexSpaceSharedAcrossTypes(wallet?.format);
}
