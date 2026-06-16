// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-chain mock address prefixes used by every shell's dev-mock SDK
// fallback (web's hostBridge, extension's background sdkFactory, desktop
// when the real SDK is not yet pinned). Not cryptographically valid —
// just distinguishable so a Dogecoin "D…" address doesn't look like a
// Bitcoin "1…" address while the wallet is running on the stub. The
// real `xchain-sdk` performs proper version-byte derivation.
//
// Dogecoin has no segwit, so only base58 types are listed for its chains.

const MOCK_ADDRESS_PREFIXES = {
    'bitcoin-mainnet':  { p2pkh: '1devmock',  'p2sh-p2wpkh': '3devmock', p2wpkh: 'bc1qdevmock',   p2tr: 'bc1pdevmock' },
    'bitcoin-testnet':  { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'tb1qdevmock',   p2tr: 'tb1pdevmock' },
    'bitcoin-regtest':  { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'bcrt1qdevmock', p2tr: 'bcrt1pdevmock' },
    'litecoin-mainnet': { p2pkh: 'Ldevmock',  'p2sh-p2wpkh': 'Mdevmock', p2wpkh: 'ltc1qdevmock' },
    'litecoin-testnet': { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'tltc1qdevmock' },
    'litecoin-regtest': { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'rltc1qdevmock' },
    'dogecoin-mainnet': { p2pkh: 'Ddevmock',  'p2sh-p2wpkh': 'Adevmock' },
    'dogecoin-testnet': { p2pkh: 'ndevmock',  'p2sh-p2wpkh': '2devmock' },
    'dogecoin-regtest': { p2pkh: 'ndevmock',  'p2sh-p2wpkh': '2devmock' },
};

/**
 * Build a mock address for `(chainId, type, publicKeyHex)`. Mirrors the
 * shape of what `xchain-sdk`'s `wallet.deriveAddress` produces but with
 * a recognizable `…devmock…` token and no real cryptography.
 *
 * @param {string} chainId        e.g. 'dogecoin-mainnet'
 * @param {string} type           e.g. 'p2pkh' / 'p2wpkh' / 'p2tr'
 * @param {string} publicKeyHex
 * @returns {string}
 */
export function mockDeriveAddress(chainId, type, publicKeyHex) {
    const chainPrefixes = MOCK_ADDRESS_PREFIXES[chainId]
        ?? MOCK_ADDRESS_PREFIXES['bitcoin-mainnet'];
    const prefix = chainPrefixes[type] ?? `${type}:`;
    const tail = String(publicKeyHex || '').slice(0, 24).toLowerCase();
    return `${prefix}${tail}`;
}
