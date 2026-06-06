// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// WIF (Wallet Import Format) encoding. Turns a 32-byte private key into
// the base58check string the SDK expects (`WalletUtils.importWIF`), and
// vice versa.
//
// Version bytes per chain/network are pulled from the chain descriptor;
// callers pass them explicitly rather than this module hardcoding them.

import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';

const bsc = base58check(sha256);

/**
 * @param {Uint8Array} privateKey   32 bytes
 * @param {number} wifVersionByte   e.g. 0x80 for BTC mainnet, 0xef for BTC testnet
 * @param {boolean} [compressed]    default true
 * @returns {string}
 */
export function encodeWif(privateKey, wifVersionByte, compressed = true) {
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
        throw new Error('wif: privateKey must be a 32-byte Uint8Array');
    }
    const payload = new Uint8Array(1 + 32 + (compressed ? 1 : 0));
    payload[0] = wifVersionByte;
    payload.set(privateKey, 1);
    if (compressed) payload[payload.length - 1] = 0x01;
    return bsc.encode(payload);
}

/**
 * Decode a WIF string. Returns raw private key, the inferred compression
 * flag, and the leading version byte (caller verifies it matches the
 * expected network).
 *
 * @param {string} wif
 * @returns {{ privateKey: Uint8Array, compressed: boolean, versionByte: number }}
 */
export function decodeWif(wif) {
    const payload = bsc.decode(wif);
    if (payload.length !== 33 && payload.length !== 34) {
        throw new Error(`wif: unexpected payload length ${payload.length}`);
    }
    const versionByte = payload[0];
    const compressed = payload.length === 34;
    if (compressed && payload[payload.length - 1] !== 0x01) {
        throw new Error('wif: compressed flag byte must be 0x01');
    }
    const privateKey = payload.slice(1, 33);
    return { privateKey, compressed, versionByte };
}
