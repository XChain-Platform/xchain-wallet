// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `crypto.randomUUID()` is gated on a secure context, so a wallet
// loaded over plain HTTP throws `crypto.randomUUID is not a function`
// from any schema factory that mints an entity id. This helper uses
// `crypto.randomUUID()` when available and falls back to a manual
// UUIDv4 built from `crypto.getRandomValues()` (which works in every
// context, secure or not).
//
// Output format: 8-4-4-4-12 lowercase hex with the standard v4 +
// variant bits set (digit 13 = '4', digit 17 ∈ {'8','9','a','b'}).

const HEX = '0123456789abcdef';

function fallback() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;  // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80;  // variant RFC 4122
    let s = '';
    for (let i = 0; i < 16; i += 1) {
        const b = bytes[i];
        s += HEX[b >>> 4] + HEX[b & 0x0f];
        if (i === 3 || i === 5 || i === 7 || i === 9) s += '-';
    }
    return s;
}

/**
 * Returns a UUIDv4 string. Drop-in replacement for `crypto.randomUUID()`
 * that works in non-secure contexts.
 *
 * @returns {string}
 */
export function randomUUID() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return fallback();
}
