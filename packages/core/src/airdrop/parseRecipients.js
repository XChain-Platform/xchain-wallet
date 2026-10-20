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
// Pass the ACTIVE chain and every candidate is decoded against
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

import {
    isValidAddressAnyNetwork,
    isValidAddressForChain,
} from '../shared/utils/addressValidation.js';
import { parseCsvRecords } from '../shared/utils/csv.js';

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;
// Bech32 shape per BIP173: a human-readable part, the last `1` as separator, then at
// least six data characters from the Bech32 charset. Tested against the lowercased value.
const BECH32_SHAPE = /^[0-9a-z]+1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/;
// An address reference: a caret, then an index with no leading zero, the same
// canonical form the indexer accepts for a LIST address item. The wallet never
// publishes one; it only names it so the form can say why it was skipped.
const ADDRESS_REF = /^\^[1-9][0-9]*$/;
// Human-readable prefixes of every bech32 address family the wallet pays.
const BECH32_PREFIX = /^(?:bc1|tb1|bcrt1|ltc1|tltc1|rltc1)/i;

/**
 * Split a paste-box string into raw candidate strings. Handles line-
 * separated and comma-separated inputs; strips surrounding whitespace,
 * matched quotes, and empty lines.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parsePaste(text) {
    return parsePasteEntries(text).map(({ value }) => value);
}

/**
 * Parse pasted recipients while retaining each candidate's physical line.
 * Comma-separated candidates on one row share that row's line number.
 *
 * @param {string} text
 * @returns {Array<{ value: string, line: number }>}
 */
export function parsePasteEntries(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const out = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let index = 0; index < lines.length; index += 1) {
        for (const raw of lines[index].split(/,+/g)) {
            const value = stripWrappingQuotes(raw.trim());
            if (value.length > 0) out.push({ value, line: index + 1 });
        }
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
    return parseCsvEntries(text).map(({ value }) => value);
}

/**
 * Parse first-column CSV recipients while retaining the physical line where
 * each RFC 4180 record starts.
 *
 * @param {string} text
 * @returns {Array<{ value: string, line: number }>}
 */
export function parseCsvEntries(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const rows = parseCsvRecords(text);
    const out = [];
    // Find the header after any BOM and leading blank lines exported by spreadsheets.
    const firstContent = rows.findIndex(({ cells }) => cells.some((cell) => cell.trim().length > 0));
    if (firstContent === -1) return [];
    const firstCol = rows[firstContent].cells[0].trim().replace(/^\uFEFF/, '').toLowerCase();
    const start = firstContent + (firstCol === 'address' ? 1 : 0);
    for (let i = start; i < rows.length; i += 1) {
        const first = rows[i].cells[0].trim().replace(/^\uFEFF/, '');
        if (first.length > 0) out.push({ value: first, line: rows[i].line });
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
    // emit lowercase). Mixed case is never Bech32 (BIP173), and a string
    // without the HRP-separator-data shape falls through to the Base58 check.
    const lower = s.toLowerCase();
    if ((s === lower || s === s.toUpperCase()) && BECH32_SHAPE.test(lower)) return true;
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
 * duplicate wins. A valid bech32 entry comes back lowercase, so the
 * wallet never publishes an uppercase spelling; rejected entries stay
 * as pasted so the user can find them.
 *
 * `wrongNetwork` is the subset of `invalid` that IS a real address, just
 * not one this chain can pay: those are the entries worth naming
 * separately, because "invalid" reads as a typo and this is not one.
 * They stay inside `invalid` as well so every existing count ("N invalid
 * skipped") keeps totalling the entries that were actually dropped.
 *
 * `addressRefs` is the subset of `invalid` written as an address reference
 * (`^<index>`). The wallet does not resolve references, so they are still
 * dropped, but they are not typos either and the form says so.
 *
 * @param {string[]} candidates
 * @param {{ coin?: string, network?: string, networkKind?: string } | null} [chain]
 * @returns {{ valid: string[], invalid: string[], duplicates: number, wrongNetwork: string[],
 *   addressRefs: string[] }}
 */
export function classifyRecipients(candidates, chain) {
    const classifier = createRecipientClassifier(chain, false);
    for (const raw of candidates) classifier.add(raw);
    return classifier.result();
}

function createRecipientClassifier(chain, includeLines) {
    /** @type {string[]} */
    const valid = [];
    /** @type {string[]} */
    const invalid = [];
    /** @type {string[]} */
    const wrongNetwork = [];
    /** @type {string[]} */
    const addressRefs = [];
    const params = chainParams(chain);
    const seen = new Set();
    const invalidLines = [];
    const wrongNetworkLines = [];
    let duplicates = 0;
    const add = (raw, line) => {
        const candidate = String(raw ?? '').trim();
        if (!candidate) return;
        const duplicateKey = bech32IdentityKey(candidate);
        if (seen.has(duplicateKey)) {
            duplicates += 1;
            return;
        }
        seen.add(duplicateKey);
        if (isRecipientForChain(candidate, chain)) {
            // Publish the lowercase bech32 form, which every wallet emits (BIP173).
            valid.push(duplicateKey);
            return;
        }
        invalid.push(candidate);
        if (includeLines) invalidLines.push({ address: candidate, line });
        // Only meaningful once a chain is known: it is the difference
        // between "this is not an address" and "this is an address for
        // somewhere else".
        if (params && isValidAddressAnyNetwork(candidate)) {
            wrongNetwork.push(candidate);
            if (includeLines) wrongNetworkLines.push({ address: candidate, line });
        }
        // Name an address reference, which is a real chain form and not a typo.
        if (ADDRESS_REF.test(candidate)) addressRefs.push(candidate);
    };
    const result = () => includeLines
        ? { valid, invalid, duplicates, wrongNetwork, addressRefs, invalidLines, wrongNetworkLines }
        : { valid, invalid, duplicates, wrongNetwork, addressRefs };
    return { add, result };
}

/**
 * Classify parsed entries and retain source locations for rejected rows.
 * The canonical string arrays match `classifyRecipients`, so publishing and
 * pricing use the same first-occurrence-wins duplicate rule as plain paste.
 *
 * @param {Array<{ value: string, line: number }>} entries
 * @param {{ coin?: string, network?: string, networkKind?: string } | null} [chain]
 * @returns {{ valid: string[], invalid: string[], duplicates: number, wrongNetwork: string[],
 *   addressRefs: string[], invalidLines: Array<{ address: string, line: number }>,
 *   wrongNetworkLines: Array<{ address: string, line: number }> }}
 */
export function classifyRecipientEntries(entries, chain) {
    const classifier = createRecipientClassifier(chain, true);
    for (const entry of entries) classifier.add(entry?.value, entry?.line);
    return classifier.result();
}

/**
 * Classify a large parsed list in bounded chunks so input and paint tasks can
 * run between batches. A cancelled classification returns null.
 *
 * @param {Array<{ value: string, line: number }>} entries
 * @param {{ coin?: string, network?: string, networkKind?: string } | null} [chain]
 * @param {{ chunkSize?: number, yieldTask?: () => Promise<void>, shouldCancel?: () => boolean }} [options]
 * @returns {Promise<ReturnType<typeof classifyRecipientEntries> | null>}
 */
export async function classifyRecipientEntriesAsync(entries, chain, options = {}) {
    const rawChunkSize = Number(options.chunkSize);
    const chunkSize = Number.isInteger(rawChunkSize) && rawChunkSize > 0 ? rawChunkSize : 250;
    const yieldTask = options.yieldTask || (() => new Promise((resolve) => setTimeout(resolve, 0)));
    const shouldCancel = options.shouldCancel || (() => false);
    const classifier = createRecipientClassifier(chain, true);

    for (let index = 0; index < entries.length; index += 1) {
        if (index > 0 && index % chunkSize === 0) {
            await yieldTask();
            if (shouldCancel()) return null;
        }
        const entry = entries[index];
        classifier.add(entry?.value, entry?.line);
    }
    return classifier.result();
}

/**
 * Compare the recipient list the wallet believes it published against the
 * list the chain actually stored, once the LIST action has been indexed.
 *
 * that second half: the parser check is client-side, so it can still
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
    const gotBech32 = new Set();
    for (const row of got) {
        const s = String(
            (row && typeof row === 'object' ? (row.address ?? row.item ?? '') : row) ?? '',
        ).trim();
        if (!s) continue;
        gotExact.add(s);
        if (isValidBech32Address(s)) gotBech32.add(s.toLowerCase());
    }
    const missing = want.filter((a) => a
        && !gotExact.has(a)
        && !(isValidBech32Address(a) && gotBech32.has(a.toLowerCase())));
    return {
        expectedCount: want.length,
        storedCount: gotExact.size,
        missing,
        ok: missing.length === 0,
    };
}

function isValidBech32Address(address) {
    return BECH32_PREFIX.test(address) && isValidAddressAnyNetwork(address);
}

/**
 * The key two spellings of one address share. Bech32 is case-insensitive
 * when the whole address uses one case, so a single-case bech32 address
 * folds to lowercase; mixed case and base58 come back unchanged.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function bech32IdentityKey(value) {
    const s = String(value ?? '');
    const singleCase = s === s.toLowerCase() || s === s.toUpperCase();
    return singleCase && BECH32_PREFIX.test(s) ? s.toLowerCase() : s;
}

/**
 * Split the addresses an AIRDROP reaches into the ones the network pays and
 * the ones the dropped token's own access lists exclude. With an allow list
 * only its members are paid, and an empty one pays nobody; a block-list
 * member is never paid; a list given as null applies no filter.
 *
 * The network compares stored address strings, and case variants of one
 * bech32 address share a single stored address, so membership here compares
 * `bech32IdentityKey` values. Order is kept and repeats count once.
 *
 * @param {Array<string|{address?: string, item?: string}>} addresses
 * @param {{ allow?: Array<string|{address?: string, item?: string}> | null,
 *   block?: Array<string|{address?: string, item?: string}> | null }} [lists]
 * @returns {{ approved: string[], excluded: string[] }}
 */
export function applyTokenAccessLists(addresses, lists = {}) {
    const keyOf = (row) => bech32IdentityKey(listEntryText(row));
    const allowKeys = Array.isArray(lists.allow) ? new Set(lists.allow.map(keyOf)) : null;
    const blockKeys = Array.isArray(lists.block) ? new Set(lists.block.map(keyOf)) : null;
    const approved = [];
    const excluded = [];
    const seen = new Set();
    for (const row of Array.isArray(addresses) ? addresses : []) {
        const address = listEntryText(row);
        const key = bech32IdentityKey(address);
        if (!address || seen.has(key)) continue;
        seen.add(key);
        // Skip an address missing from the token's allow list.
        if (allowKeys && !allowKeys.has(key)) {
            excluded.push(address);
            continue;
        }
        // Skip an address on the token's block list.
        if (blockKeys && blockKeys.has(key)) {
            excluded.push(address);
            continue;
        }
        approved.push(address);
    }
    return { approved, excluded };
}

// Read a list member that arrives as a bare string or as an `{ address }` / `{ item }` row.
function listEntryText(row) {
    const value = row && typeof row === 'object' ? (row.address ?? row.item ?? '') : row;
    return String(value ?? '').trim();
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
