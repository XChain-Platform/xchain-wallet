// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Client-side recipient-address validation. The dev-SDK builds stub
// `validateAddress` (any non-empty string passes), so to actually catch
// random text in a form we validate the address ourselves against the
// target network: a base58check checksum + version byte for legacy
// (P2PKH / P2SH) addresses, or a bech32/bech32m decode + human-readable
// prefix for segwit. Mirrors the indexer's `isCryptoAddress` table so the
// wallet and the chain agree on what a valid address looks like.

import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';

const bsc = base58check(sha256);

// Address version bytes (P2PKH / P2SH) + segwit prefix (HRP) per coin and
// network. DOGE has no segwit HRP. Same constants the indexer validates with.
const ADDRESS_PARAMS = {
    bitcoin: {
        mainnet: { p2pkh: 0x00, p2sh: 0x05, hrp: 'bc' },
        testnet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tb' },
        regtest: { p2pkh: 0x6f, p2sh: 0xc4, hrp: 'bcrt' },
    },
    litecoin: {
        mainnet: { p2pkh: 0x30, p2sh: 0x32, hrp: 'ltc' },
        testnet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tltc' },
        regtest: { p2pkh: 0x6f, p2sh: 0xc4, hrp: 'rltc' },
    },
    dogecoin: {
        mainnet: { p2pkh: 0x1e, p2sh: 0x16, hrp: null },
        testnet: { p2pkh: 0x71, p2sh: 0xc4, hrp: null },
        regtest: { p2pkh: 0x6f, p2sh: 0xc4, hrp: null },
    },
};

// Dev-SDK builds derive placeholder addresses like "1devmock<hex>" or
// "bc1qdevmock<hex>" (see sdk/devMockAddresses.js). Accept them so the
// validator doesn't reject every address while running on the stub; no real
// on-chain address carries this marker.
function looksLikeDevMock(address) {
    return /devmock/i.test(address);
}

// True when `address` is well-formed for one specific coin+network's params.
function matchesParams(address, params) {
    if (!params) return false;
    // Segwit (bech32 / bech32m) when the coin has an HRP and the address looks
    // like a bech32 string for this network.
    if (params.hrp && address.toLowerCase().startsWith(`${params.hrp}1`)) {
        const lower = address.toLowerCase();
        for (const codec of [bech32, bech32m]) {
            try {
                if (codec.decode(lower, 1023).prefix === params.hrp) return true;
            } catch { /* try the other encoding */ }
        }
        return false;
    }
    // Legacy base58check (P2PKH / P2SH): 1 version byte + 20-byte hash160.
    try {
        const payload = bsc.decode(address);
        return payload.length === 21 && (payload[0] === params.p2pkh || payload[0] === params.p2sh);
    } catch {
        return false;
    }
}

/**
 * Best-effort detection of which coin a recipient address belongs to, so a
 * message's COIN field (the destination's network) can be set from the address
 * rather than the chain it's broadcast on. Returns 'bitcoin' | 'litecoin' |
 * 'dogecoin' only when the leading characters are coin-exclusive (covers
 * mainnet legacy leaders, all segwit HRPs, and the dev-mock prefixes); returns
 * null for the shared '3' P2SH and the shared 'm'/'n'/'2' testnet/regtest
 * leaders, where the coin can't be told from the string alone.
 *
 * @param {string} address
 * @returns {'bitcoin' | 'litecoin' | 'dogecoin' | null}
 */
export function detectAddressCoin(address) {
    const a = String(address || '').trim();
    if (!a) return null;
    const lower = a.toLowerCase();
    // Segwit HRPs are coin + network specific, so always unambiguous.
    if (lower.startsWith('bc1') || lower.startsWith('tb1') || lower.startsWith('bcrt1')) return 'bitcoin';
    if (lower.startsWith('ltc1') || lower.startsWith('tltc1') || lower.startsWith('rltc1')) return 'litecoin';
    // Legacy base58 leaders. Coin-exclusive on mainnet; also the dev-mock
    // prefixes. '3' / 'm' / 'n' / '2' are shared, so left ambiguous (null).
    const c = a[0];
    if (c === '1') return 'bitcoin';
    if (c === 'L' || c === 'M') return 'litecoin';
    if (c === 'D' || c === 'A' || c === '9') return 'dogecoin';
    return null;
}

/**
 * True when `address` is a structurally valid address for ONE specific coin and
 * network. This is the check a value-bearing action (SEND, SWEEP, DISPENSER,
 * COINPAY) needs: those pay an on-chain output on the chain they're broadcast
 * on, so a destination for a different coin, or for the right coin on the wrong
 * network, is unspendable. Distinct from `isValidAddressAnyNetwork`, which is
 * correct only for MESSAGE (whose recipient is deliberately chain-independent).
 *
 * Checks the base58check checksum / bech32 decode, so it also catches a typo'd
 * or truncated address that happens to keep a plausible leading character.
 *
 * @param {string} address
 * @param {string} coin       'bitcoin' | 'litecoin' | 'dogecoin'
 * @param {string} network    'mainnet' | 'testnet' | 'regtest'
 * @returns {boolean}
 */
export function isValidAddressForChain(address, coin, network) {
    const a = String(address || '').trim();
    if (!a) return false;
    if (looksLikeDevMock(a)) return true;
    const params = ADDRESS_PARAMS[coin]?.[network];
    if (!params) return false;
    return matchesParams(a, params);
}

/**
 * True when `address` is a structurally valid address on ANY supported coin and
 * network (or a dev-mock placeholder). A MESSAGE can be broadcast on any chain
 * regardless of the recipient's chain (a Bitcoin address can be messaged over
 * Dogecoin; see protocol/actions/MESSAGE.md), so the recipient address must NOT
 * be tied to the delivery network: it only needs to be a real address. Does not
 * check whether the address has ever been used on-chain, only that it is
 * well-formed.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isValidAddressAnyNetwork(address) {
    const a = String(address || '').trim();
    if (!a) return false;
    if (looksLikeDevMock(a)) return true;
    for (const coin of Object.keys(ADDRESS_PARAMS)) {
        for (const network of Object.keys(ADDRESS_PARAMS[coin])) {
            if (matchesParams(a, ADDRESS_PARAMS[coin][network])) return true;
        }
    }
    return false;
}
