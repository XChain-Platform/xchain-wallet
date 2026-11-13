// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The stored forms of an agent account's token rules (policy.allowedTicks and
// policy.tickIds). They live beside the schemas because the account schema
// validates a stored record with them, so they carry no registry or flow
// dependency; cosigner/allowedTicks.js re-exports them for the evaluator.

// A value read off a plain object only when it is the object's own property.
export function ownValue(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

// Consensus reads ticks case-insensitively over an ASCII charset, so folding
// a-z alone matches the indexer's grouping (the SDK evaluator folds the same way).
export function foldTick(tick) {
    return String(tick).replace(/[a-z]/g, (c) => c.toUpperCase());
}

/**
 * The stored form of the rule: null for any token, otherwise a folded,
 * de-duplicated list (empty means no tokens). Anything that is not an array
 * reads as "any token" so a record from before the rule keeps working.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
export function normalizeAllowedTicks(value) {
    if (!Array.isArray(value)) return null;
    const out = [];
    const seen = new Set();
    for (const raw of value) {
        const tick = foldTick(String(raw ?? '').trim());
        if (!tick || seen.has(tick)) continue;
        seen.add(tick);
        out.push(tick);
    }
    return out;
}

/**
 * The stored form of policy.tickIds: { TICKER: number } with folded tickers
 * and positive whole-number ids, or null when nothing valid is declared. An
 * entry that is not a whole number, or a number a second ticker already
 * claims, is dropped, so the map never lets one id stand for two tokens.
 *
 * @param {unknown} value
 * @returns {Record<string, number> | null}
 */
export function normalizeTickIds(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out = {};
    const seenIds = new Set();
    for (const raw of Object.keys(value)) {
        const name = foldTick(String(raw).trim());
        const idText = String(ownValue(value, raw) ?? '').trim();
        if (!name || name.charAt(0) === '^' || Object.prototype.hasOwnProperty.call(out, name)) continue;
        if (!/^[1-9][0-9]*$/.test(idText)) continue;
        const id = Number(idText);
        if (!Number.isSafeInteger(id) || seenIds.has(id)) continue;
        seenIds.add(id);
        out[name] = id;
    }
    return Object.keys(out).length > 0 ? out : null;
}
