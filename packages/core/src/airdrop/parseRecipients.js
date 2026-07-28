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
// structured split the UI renders: valid / invalid / duplicates /
// wrongNetwork.
//
// : pass the ACTIVE chain and every candidate is decoded against
// THAT coin+network's address parameters, the same check Send makes on
// its destination. Without it the form only tested length + charset, so
// a mainnet address pasted into a regtest wallet counted as valid all
// the way through review, dry-run and broadcast - and then the indexer
// dropped it into `list_items_invalid` (status 60, `invalid: ADDRESS
// (format)`) while marking the LIST itself valid. The list was one item
// short of the list the user was shown and paid for, permanently, with
// no wallet screen ever saying so.
//
// Chain-less callers keep the old loose behaviour (length + charset,
// matching xchain-sdk `util.isCryptoAddress` plus a charset guard for
// paste artifacts), because a form that does not yet know its chain
// still has to render something. Every real call site passes a chain.

import { isValidAddressForChain } from '../shared/utils/addressValidation.js';

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
 * Read a coin + network pair off either shape a caller has to hand: a
 * chain descriptor from the registry (`{ coin, networkKind }`) or a
 * plain `{ coin, network }`. Returns null unless BOTH are present, so a
 * half-populated descriptor falls back to the loose check rather than
 * rejecting every address.
 *
 * @param {{ coin?: string, network?: string, networkKind?: string } | null | undefined} chain
 * @returns {{ coin: string, network: string } | null}
 */
function chainParams(chain) {
    const coin = chain?.coin;
    const network = chain?.network ?? chain?.networkKind;
    if (!coin || !network) return null;
    return { coin, network };
}

/**
 * True when `addr` is a usable recipient for `chain`. With a chain, this
 * is the real thing: a base58check checksum + version byte, or a bech32
 * decode + human-readable prefix, for that exact coin and network - so a
 * mainnet address on a regtest wallet, a Litecoin address on Bitcoin, and
 * a typo that survives the leading character are all rejected. Without a
 * chain it degrades to the legacy length + charset guess.
 *
 * @param {string} addr
 * @param {{ coin?: string, network?: string, networkKind?: string } | null} [chain]
 * @returns {boolean}
 */
export function isRecipientForChain(addr, chain) {
    const params = chainParams(chain);
    if (!params) return isPlausibleAddress(addr);
    if (typeof addr !== 'string') return false;
    return isValidAddressForChain(addr.trim(), params.coin, params.network);
}

/**
 * Split a raw candidate list into valid addresses, invalid entries, and
 * a duplicate count. Order-preserving; the first occurrence of a
 * duplicate wins.
 *
 * `wrongNetwork` is the subset of `invalid` that IS a real address, just
 * not one this chain can pay: those are the entries worth naming
 * separately, because "invalid" reads as a typo and this is not one.
 * They stay inside `invalid` as well so every existing count ("N invalid
 * skipped") keeps totalling the entries that were actually dropped.
 *
 * @param {string[]} candidates
 * @param {{ coin?: string, network?: string, networkKind?: string } | null} [chain]
 * @returns {{ valid: string[], invalid: string[], duplicates: number, wrongNetwork: string[] }}
 */
export function classifyRecipients(candidates, chain) {
    /** @type {string[]} */
    const valid = [];
    /** @type {string[]} */
    const invalid = [];
    /** @type {string[]} */
    const wrongNetwork = [];
    const params = chainParams(chain);
    const seen = new Set();
    let duplicates = 0;
    for (const raw of candidates) {
        if (seen.has(raw)) {
            duplicates += 1;
            continue;
        }
        seen.add(raw);
        if (isRecipientForChain(raw, chain)) {
            valid.push(raw);
            continue;
        }
        invalid.push(raw);
        // Only meaningful once a chain is known: it is the difference
        // between "this is not an address" and "this is an address for
        // somewhere else".
        if (params && isPlausibleAddress(raw)) wrongNetwork.push(raw);
    }
    return { valid, invalid, duplicates, wrongNetwork };
}

/**
 * Compare the recipient list the wallet believes it published against the
 * list the chain actually stored, once the LIST action has been indexed.
 *
 * 's second half: the parser check is client-side, so it can still
 * be wrong (an older wallet build, a chain rule the wallet does not model
 * yet). The indexer silently drops items it rejects into
 * `list_items_invalid` and marks the LIST action itself valid, so the
 * only way to learn the real membership is to read the stored list back.
 * Doing that BEFORE pricing step 2 is what stops the user being quoted a
 * per-recipient AIRDROP fee for recipients that do not exist.
 *
 * Stored items arrive either as bare strings or as `{ address }` /
 * `{ item }` rows depending on the read; both are accepted. Matching is
 * exact first, then case-insensitive, since bech32 is case-folding while
 * base58 is not.
 *
 * @param {string[]} expected  addresses the wallet submitted
 * @param {Array<string|{address?: string, item?: string}>} stored  list read back from the chain
 * @returns {{ expectedCount: number, storedCount: number, missing: string[], ok: boolean }}
 */
export function reconcileStoredList(expected, stored) {
    const want = Array.isArray(expected) ? expected.map((a) => String(a ?? '').trim()) : [];
    const got = Array.isArray(stored) ? stored : [];
    const gotExact = new Set();
    const gotLower = new Set();
    for (const row of got) {
        const s = String(
            (row && typeof row === 'object' ? (row.address ?? row.item ?? '') : row) ?? '',
        ).trim();
        if (!s) continue;
        gotExact.add(s);
        gotLower.add(s.toLowerCase());
    }
    const missing = want.filter((a) => a && !gotExact.has(a) && !gotLower.has(a.toLowerCase()));
    return {
        expectedCount: want.length,
        storedCount: gotExact.size,
        missing,
        ok: missing.length === 0,
    };
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
