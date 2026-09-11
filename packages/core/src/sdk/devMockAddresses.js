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
// when the real SDK is not yet pinned). Not cryptographically valid;
// just distinguishable so a Dogecoin "D…" address doesn't look like a
// Bitcoin "1…" address while the wallet is running on the stub. The
// real `xchain-sdk` performs proper version-byte derivation.
//
// Dogecoin has no segwit, so only base58 types are listed for its chains.

import { defaultRegistry } from '../registry/index.js';

export const MOCK_ADDRESS_PREFIXES = {
    'bitcoin-mainnet':  { p2pkh: '1devmock',  'p2sh-p2wpkh': '3devmock', p2wpkh: 'bc1qdevmock',   p2tr: 'bc1pdevmock' },
    'bitcoin-testnet':  { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'tb1qdevmock',   p2tr: 'tb1pdevmock' },
    'bitcoin-regtest':  { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'bcrt1qdevmock', p2tr: 'bcrt1pdevmock' },
    'litecoin-mainnet': { p2pkh: 'Ldevmock',  'p2sh-p2wpkh': 'Mdevmock', p2wpkh: 'ltc1qdevmock' },
    'litecoin-testnet': { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'tltc1qdevmock' },
    'litecoin-regtest': { p2pkh: 'mdevmock',  'p2sh-p2wpkh': '2devmock', p2wpkh: 'rltc1qdevmock' },
    // Only p2pkh: the dogecoin descriptor's addressTypes is ['p2pkh'], and a
    // segwit row here contradicts both it and the comment above.
    'dogecoin-mainnet': { p2pkh: 'Ddevmock' },
    'dogecoin-testnet': { p2pkh: 'ndevmock' },
    'dogecoin-regtest': { p2pkh: 'ndevmock' },
};

// How many characters of the public key `mockDeriveAddress` appends.
const MOCK_TAIL_LENGTH = 24;

// Every distinct prefix the table above can produce. Deduped so the
// recognizer's alternation stays short (many chains share 'mdevmock' /
// '2devmock'). Sorted longest-first so the alternation cannot match a
// short prefix where a longer one applies (e.g. 'bc1qdevmock' before
// '1devmock' would otherwise be irrelevant here, but the ordering makes
// the regex robust if a future prefix is a prefix of another).
const MOCK_PREFIXES = Object.freeze(
    [...new Set(Object.values(MOCK_ADDRESS_PREFIXES).flatMap((byType) => Object.values(byType)))]
        .sort((a, b) => b.length - a.length),
);

// Anchored full-string shape of a dev-mock address: one known prefix plus
// up to MOCK_TAIL_LENGTH lowercase hex characters, and nothing else.
// Deliberately NOT a substring search: this recognizer is consulted by the
// production address validator, so a bare /devmock/ test would let any
// pasted string containing that word through as a "valid" address.
// Case-sensitive on purpose - the prefixes carry meaningful case ('Ldevmock'
// vs 'ldevmock'), and only the tail is lowercased at build time.
const MOCK_ADDRESS_RE = new RegExp(
    `^(?:${MOCK_PREFIXES.join('|')})[0-9a-f]{0,${MOCK_TAIL_LENGTH}}$`,
);

/**
 * True when `address` has the exact shape `mockDeriveAddress` produces.
 * No real on-chain address can match: none of the prefixes are valid
 * base58check or bech32 payloads.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isDevMockAddress(address) {
    return MOCK_ADDRESS_RE.test(String(address ?? '').trim());
}

/**
 * Build a mock address for `(chainId, type, publicKeyHex)`. Mirrors the
 * shape of what `xchain-sdk`'s `wallet.deriveAddress` produces but with
 * a recognizable `…devmock…` token and no real cryptography.
 *
 * @param {string} chainId        e.g. 'dogecoin-mainnet'
 * @param {string} [type]         e.g. 'p2pkh' / 'p2wpkh' / 'p2tr'; omitted means the chain descriptor's defaultAddressType
 * @param {string} publicKeyHex
 * @returns {string}
 */
export function mockDeriveAddress(chainId, type, publicKeyHex) {
    const chainPrefixes = MOCK_ADDRESS_PREFIXES[chainId]
        ?? MOCK_ADDRESS_PREFIXES['bitcoin-mainnet'];
    // Resolve an absent type from the registry rather than guessing segwit
    // (dogecoin is p2pkh-only, so a p2wpkh guess has no row and leaks
    // 'p2wpkh:' into the dev shell where an address belongs).
    const resolved = type
        ?? defaultRegistry().descriptorFor(chainId)?.defaultAddressType
        ?? 'p2pkh';
    const prefix = chainPrefixes[resolved] ?? `${resolved}:`;
    const tail = String(publicKeyHex || '').slice(0, MOCK_TAIL_LENGTH).toLowerCase();
    return `${prefix}${tail}`;
}
