// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lookalike address detection: §21.5 + §12.3.
//
// On paste / blur, compare the entered address against the user's
// known set (contacts + recent send history). A warning covers both
// near-edit typos and address-poisoning matches that preserve the first
// and last visible characters while replacing the middle.
//
// The Send route feeds in the same `Suggestion[]` it already uses for
// autocomplete. Near-edit matching uses a per-character similarity score;
// matching-end detection is independent so a fully replaced middle still
// triggers the warning.

/**
 * Levenshtein edit distance between two strings. Iterative DP over a
 * single row buffer; O(min(a, b)) memory.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return Infinity;
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Ensure b is the longer string so the row buffer is the shorter.
    let s = a;
    let t = b;
    if (s.length > t.length) { const tmp = s; s = t; t = tmp; }

    const prev = new Array(s.length + 1);
    const curr = new Array(s.length + 1);
    for (let i = 0; i <= s.length; i += 1) prev[i] = i;

    for (let j = 1; j <= t.length; j += 1) {
        curr[0] = j;
        for (let i = 1; i <= s.length; i += 1) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            curr[i] = Math.min(
                curr[i - 1] + 1,        // insertion
                prev[i] + 1,            // deletion
                prev[i - 1] + cost,     // substitution
            );
        }
        for (let i = 0; i <= s.length; i += 1) prev[i] = curr[i];
    }
    return prev[s.length];
}

/**
 * Similarity score in [0, 1]: 1 = identical, 0 = totally different.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    const dist = levenshtein(a, b);
    return 1 - dist / max;
}

/**
 * @typedef {object} LookalikeOpts
 * @property {string} address               address the user entered
 * @property {Array<{ address: string, label?: string }>} candidates  known set (contacts + history)
 * @property {number} [threshold]           near-edit similarity threshold. Default 0.9.
 * @property {number} [minLength]           skip when entered address is shorter than this (avoids matching half-typed input). Default 20.
 * @property {number} [maxDistance]         near-edit distance ceiling. Default 4.
 */

/**
 * @typedef {object} LookalikeMatch
 * @property {{ address: string, label?: string }} match
 * @property {number} score
 * @property {number} distance
 * @property {'matching-ends' | 'near-edit'} kind
 * @property {number} prefixLength
 * @property {number} suffixLength
 */

function sharedEdgeLength(a, b, fromEnd = false) {
    const limit = Math.min(a.length, b.length, 6);
    let length = 0;
    while (length < limit) {
        const aIndex = fromEnd ? a.length - 1 - length : length;
        const bIndex = fromEnd ? b.length - 1 - length : length;
        if (a[aIndex] !== b[bIndex]) break;
        length += 1;
    }
    return length;
}

/**
 * Check `address` against `candidates`. Returns the closest known
 * address that either shares 4-6 characters at both ends or scores above
 * the edit-distance threshold. Identical addresses never produce a warning.
 *
 * @param {LookalikeOpts} opts
 * @returns {LookalikeMatch | null}
 */
export function findLookalike({
    address,
    candidates = [],
    threshold = 0.9,
    minLength = 20,
    maxDistance = 4,
} = {}) {
    if (typeof address !== 'string' || address.length < minLength) return null;
    /** @type {LookalikeMatch | null} */
    let best = null;
    for (const c of candidates) {
        const cand = c?.address;
        if (typeof cand !== 'string' || cand.length === 0) continue;
        if (cand === address) return null; // exact match → no warning

        const prefixLength = sharedEdgeLength(address, cand);
        const suffixLength = sharedEdgeLength(address, cand, true);
        if (prefixLength >= 4 && suffixLength >= 4) {
            const distance = levenshtein(address, cand);
            const score = 1 - distance / Math.max(address.length, cand.length);
            const edgeStrength = Math.min(prefixLength, suffixLength);
            const bestEdgeStrength = best?.kind === 'matching-ends'
                ? Math.min(best.prefixLength, best.suffixLength)
                : -1;
            if (
                best?.kind !== 'matching-ends'
                || edgeStrength > bestEdgeStrength
                || (edgeStrength === bestEdgeStrength && score > best.score)
            ) {
                best = {
                    match: c,
                    score,
                    distance,
                    kind: 'matching-ends',
                    prefixLength,
                    suffixLength,
                };
            }
            continue;
        }

        // A matching-ends result is the stronger security signal even when
        // another candidate happens to have a smaller edit distance.
        if (best?.kind === 'matching-ends') continue;
        // Length gating: only compare addresses within ±2 of input length.
        if (Math.abs(cand.length - address.length) > 2) continue;
        const dist = levenshtein(address, cand);
        if (dist > maxDistance) continue;
        const score = 1 - dist / Math.max(address.length, cand.length);
        if (score < threshold) continue;
        if (!best || score > best.score) {
            best = {
                match: c,
                score,
                distance: dist,
                kind: 'near-edit',
                prefixLength,
                suffixLength,
            };
        }
    }
    return best;
}
