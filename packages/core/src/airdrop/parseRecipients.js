// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pure recipient parsers for the §40.9 AIRDROP form. Kept pure (no
// React, no SDK) so the form's smoke can exercise the logic without
// spinning up jsdom.
//
// The form accepts three input shapes:
//   - A multi-line paste box (one address per line, arbitrary
//     whitespace, optional wrapping quotes).
//   - A comma-separated single line (same wrapping rules).
//   - A CSV upload whose first column is the address; additional
//     columns are ignored. A header row named "address" (any case) is
//     detected and skipped.
//
// `classifyRecipients` takes the parsed strings and returns the
// structured split the UI renders: valid / invalid / duplicates.
//
// Address validation is deliberately light: length + charset. This
// matches xchain-sdk `util.isCryptoAddress` (length-only) with an
// added charset guard to catch paste artifacts (commas, spaces,
// zero-width chars). Anything that slips through gets caught at sign
// time by the encoder's real validator.

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BECH32_ALPHABET = /^[0-9a-z]+$/; // Lowercase per BIP173; we lowercase before testing.

/**
 * Split a paste-box string into raw candidate strings. Handles line-
 * separated and comma-separated inputs; strips surrounding whitespace,
 * matched quotes, and empty lines.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parsePaste(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    // Split on any newline or comma. Keeps the split lightweight; we
    // don't try to be a full CSV parser here.
    const parts = text.split(/[\r\n,]+/g);
    const out = [];
    for (const raw of parts) {
        const trimmed = stripWrappingQuotes(raw.trim());
        if (trimmed.length > 0) out.push(trimmed);
    }
    return out;
}

/**
 * Parse a CSV string. Uses the first column; skips a single header row
 * if its first cell (lower-cased, stripped of quotes) is "address".
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseCsv(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const lines = text.split(/\r?\n/);
    const out = [];
    let skipHeader = false;
    if (lines.length > 0) {
        const firstCol = stripWrappingQuotes(firstCell(lines[0]).trim()).toLowerCase();
        if (firstCol === 'address') skipHeader = true;
    }
    for (let i = skipHeader ? 1 : 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === undefined) continue;
        const first = stripWrappingQuotes(firstCell(line).trim());
        if (first.length > 0) out.push(first);
    }
    return out;
}

/**
 * Loose address validator: length in [26,35] (P2PKH) or exactly 42
 * (segwit-style) + a matching character-set (base58 or bech32). Returns
 * false for anything else so obvious paste debris is flagged.
 *
 * @param {string} addr
 * @returns {boolean}
 */
export function isPlausibleAddress(addr) {
    if (typeof addr !== 'string') return false;
    const s = addr.trim();
    const len = s.length;
    const isP2pkhLen = len >= 26 && len <= 35;
    const isBech32Len = len === 42 || (len >= 14 && len <= 74 && s.includes('1'));
    if (!isP2pkhLen && !isBech32Len) return false;
    // Bech32 addresses are all-lowercase (or all-uppercase; wallets
    // emit lowercase). Try lowercase match first.
    if (BECH32_ALPHABET.test(s.toLowerCase())) return true;
    if (BASE58_ALPHABET.test(s)) return true;
    return false;
}

/**
 * Split a raw candidate list into valid addresses, invalid entries,
 * and a duplicate count. Order-preserving; the first occurrence of a
 * duplicate wins.
 *
 * @param {string[]} candidates
 * @returns {{ valid: string[], invalid: string[], duplicates: number }}
 */
export function classifyRecipients(candidates) {
    /** @type {string[]} */
    const valid = [];
    /** @type {string[]} */
    const invalid = [];
    const seen = new Set();
    let duplicates = 0;
    for (const raw of candidates) {
        if (seen.has(raw)) {
            duplicates += 1;
            continue;
        }
        seen.add(raw);
        if (isPlausibleAddress(raw)) valid.push(raw);
        else invalid.push(raw);
    }
    return { valid, invalid, duplicates };
}

function stripWrappingQuotes(s) {
    if (s.length < 2) return s;
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
        return s.slice(1, -1).trim();
    }
    return s;
}

function firstCell(line) {
    // Minimal CSV cell extractor: takes everything before the first
    // unquoted comma. Enough for addresses in the first column;
    // doesn't try to parse every RFC 4180 edge case.
    if (line.length === 0) return '';
    if (line[0] === '"') {
        const end = line.indexOf('"', 1);
        if (end === -1) return line;
        return line.slice(0, end + 1);
    }
    const comma = line.indexOf(',');
    if (comma === -1) return line;
    return line.slice(0, comma);
}
