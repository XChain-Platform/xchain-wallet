// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token-list (LIST TYPE=1) item parsing and the existence verdict, shared by
// the list forms so a token list reports valid / invalid / duplicate counts
// the way an address list already does. The protocol judges each ITEM on its
// own and silently leaves an unknown TICK out of the list, so the form has to
// say so before the user pays for it.

import { tickerReferenceError } from './tickerGrammar.js';
import { splitTickCoinItem } from './listTickCoin.js';

/**
 * Split pasted token-list text (newline or comma separated) into items.
 * Items are trimmed and retain their spelling; a case-insensitive repeat of
 * an earlier item is counted as a duplicate and dropped. An item that fails
 * the chain ticker grammar lands in `invalid` instead of `valid`.
 *
 * With `coinQualified`, a `COIN:rest` item is judged on its rest, repeats
 * fold on the upper-cased coin plus the lower-cased rest, and the result also
 * carries `coinOf`: one entry per `valid` item, the upper-cased coin for a
 * qualified item and null for a bare one.
 *
 * @param {string} text
 * @param {{ coinQualified?: boolean }} [options]
 * @returns {{ valid: string[], invalid: string[], duplicates: number, coinOf?: Array<string | null> }}
 */
export function classifyTickItems(text, { coinQualified = false } = {}) {
    const seen = new Set();
    const valid = [];
    const invalid = [];
    const coinOf = [];
    let duplicates = 0;
    for (const raw of String(text || '').split(/[\n,]+/)) {
        const t = raw.trim();
        if (!t) continue;
        const split = coinQualified ? splitTickCoinItem(t) : null;
        const identity = split
            ? `${split.coin}:${split.rest.toLowerCase()}`
            : t.toLowerCase();
        // Count a repeat once and keep only the first occurrence.
        if (seen.has(identity)) { duplicates += 1; continue; }
        seen.add(identity);
        const validationTarget = split?.rest ?? t;
        if (tickerReferenceError(validationTarget, { allowRef: true }) === null) {
            valid.push(t);
            if (coinQualified) coinOf.push(split?.coin ?? null);
        } else invalid.push(t);
    }
    return coinQualified ? { valid, invalid, duplicates, coinOf } : { valid, invalid, duplicates };
}

/**
 * Whether a token lookup found the token on this chain.
 *
 * `messaging.getTokenInfo` resolves a normalized record even when the
 * explorer has no row for the tick (every field null), and resolves null
 * only when the lookup is not wired or failed outright. So: a record with
 * a creator, a supply or a canonical tick is 'found'; an all-empty record
 * is 'missing'; no record at all is null (not checked).
 *
 * @param {any} info   the resolved `getTokenInfo` record, or null
 * @returns {'found' | 'missing' | null}
 */
export function tickLookupVerdict(info) {
    if (!info || typeof info !== 'object') return null;
    const found = info.creator != null || info.totalSupply != null || info.canonicalTick != null;
    return found ? 'found' : 'missing';
}
