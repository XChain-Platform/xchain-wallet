// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Counterwallet 12-word legacy mnemonic — §15.2. Import-only support
// for FreeWallet migrants. No new wallets are ever created in this
// format; the BIP39 path in ./mnemonic.js is the sole generation
// surface.
//
// Algorithm (lifted from Mnemonic.js v1.1.0, MIT):
//   Each 3-word group encodes a 32-bit integer X via
//     X = w1 + n * mod(w2 - w1, n) + n * n * mod(w3 - w2, n)
//   where n = 1626 is the wordlist length and mod is true mathematical
//   modulo (not JavaScript's %). Four 32-bit integers (12 words) →
//   32 hex chars → 16 raw bytes. Those 16 bytes are the seed passed
//   directly to BIP32 as master-seed input, matching how Counterwallet
//   / FreeWallet fed the seed into bitcoinjs `HDNode.fromSeedHex`.

import { COUNTERWALLET_WORDLIST } from './counterwallet-wordlist.js';

export const COUNTERWALLET_WORD_COUNT = 12;
export const COUNTERWALLET_WORDLIST_SIZE = 1626;

// Build the word→index lookup once.
const WORD_INDEX = (() => {
    const m = new Map();
    for (let i = 0; i < COUNTERWALLET_WORDLIST.length; i++) {
        m.set(COUNTERWALLET_WORDLIST[i], i);
    }
    return m;
})();

// Mathematical modulo — matches the upstream `_mod` helper. Needed
// because `(w2 - w1) % n` in JS can be negative.
const modMath = (a, b) => a - Math.floor(a / b) * b;

/**
 * Validate a Counterwallet mnemonic.
 *
 * @param {string} mnemonic
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateCounterwalletMnemonic(mnemonic) {
    const errors = [];
    if (typeof mnemonic !== 'string') {
        return { ok: false, errors: ['mnemonic must be a string'] };
    }
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== COUNTERWALLET_WORD_COUNT) {
        errors.push(
            `expected ${COUNTERWALLET_WORD_COUNT} words, got ${words.length}`,
        );
    }
    for (let i = 0; i < words.length; i++) {
        if (!WORD_INDEX.has(words[i])) {
            errors.push(`word ${i + 1} ("${words[i]}") is not in the Counterwallet wordlist`);
        }
    }
    return errors.length ? { ok: false, errors } : { ok: true };
}

export function isValidCounterwalletMnemonic(mnemonic) {
    return validateCounterwalletMnemonic(mnemonic).ok;
}

/**
 * Convert a Counterwallet mnemonic to the 16-byte seed (the raw bytes
 * that would be passed to BIP32 `HDKey.fromMasterSeed`). Note: this
 * intentionally returns *raw bytes*, not a BIP39-style 64-byte seed.
 * Counterwallet's seed derivation has no PBKDF2 stretching — the 32 hex
 * characters from the word decoding are themselves the seed, decoded
 * from hex to 16 bytes.
 *
 * @param {string} mnemonic
 * @returns {Uint8Array}   16 bytes
 */
export function counterwalletMnemonicToSeedBytes(mnemonic) {
    const result = validateCounterwalletMnemonic(mnemonic);
    if (!result.ok) {
        throw new Error(`counterwallet: ${result.errors.join('; ')}`);
    }
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    const n = COUNTERWALLET_WORDLIST_SIZE;
    const seed = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
        const w1 = WORD_INDEX.get(words[3 * i]);
        const w2 = WORD_INDEX.get(words[3 * i + 1]);
        const w3 = WORD_INDEX.get(words[3 * i + 2]);
        // x = w1 + n*(w2-w1 mod n) + n^2*(w3-w2 mod n)
        // Use BigInt so the intermediate (n*n*anything) doesn't exceed
        // Number.MAX_SAFE_INTEGER (1626^2 * 1625 ≈ 4.3e9 — fits, but
        // BigInt keeps the code obviously correct).
        const nb = BigInt(n);
        const x =
            BigInt(w1) +
            nb * BigInt(modMath(w2 - w1, n)) +
            nb * nb * BigInt(modMath(w3 - w2, n));
        // 8 hex chars → 4 bytes, big-endian.
        const x32 = Number(x & 0xffffffffn);
        seed[i * 4] = (x32 >>> 24) & 0xff;
        seed[i * 4 + 1] = (x32 >>> 16) & 0xff;
        seed[i * 4 + 2] = (x32 >>> 8) & 0xff;
        seed[i * 4 + 3] = x32 & 0xff;
    }
    return seed;
}

/**
 * Hex-encoded 32-character form of the seed. Matches the string fed to
 * `bitcoinjs.HDNode.fromSeedHex` in legacy Counterwallet/FreeWallet
 * codepaths.
 *
 * @param {string} mnemonic
 * @returns {string}
 */
export function counterwalletMnemonicToSeedHex(mnemonic) {
    const bytes = counterwalletMnemonicToSeedBytes(mnemonic);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
}

export { COUNTERWALLET_WORDLIST };
