// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33.2 command-palette fuzzy matcher. Dependency-free (the wallet ships
// no `cmdk`/`fuse.js`; every byte in the bundle is audited per §9.8), so
// the scoring is a small hand-rolled subsequence matcher tuned for short
// command labels rather than prose.
//
// Ranking, best first:
//   1. exact full-string match on the title
//   2. title starts with the query (prefix)
//   3. query matches a word boundary in the title ("mt" → "My Tokens")
//   4. subsequence anywhere in the title
//   5. subsequence in a keyword / subtitle (searchable but lower weight)
// A non-match on every field returns null so the caller can drop the row.

/**
 * @typedef {object} Command
 * @property {string} id
 * @property {string} category
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string[]} [keywords]
 * @property {import('react').ComponentType<any>} [Icon]
 * @property {() => void} run
 * @property {boolean} [disabled]
 */

/**
 * Score a single haystack string against the query. Higher is better;
 * 0 means "no subsequence match". The query is assumed pre-lowercased.
 *
 * @param {string} query   lowercased search string (non-empty)
 * @param {string} textRaw candidate string
 * @returns {number}
 */
export function scoreText(query, textRaw) {
    const text = textRaw.toLowerCase();
    if (!query) return 1;
    if (text === query) return 1000;
    if (text.startsWith(query)) return 800 - text.length;

    // Word-boundary acronym: first letters of whitespace/punct-delimited
    // words. "mt" matches "My Tokens", "ct" matches "Create a token".
    const initials = text
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join('');
    if (initials.startsWith(query)) return 700 - text.length;
    if (initials.includes(query)) return 600 - text.length;

    // Contiguous substring anywhere.
    const idx = text.indexOf(query);
    if (idx >= 0) return 500 - idx - text.length * 0.1;

    // Ordered-subsequence fallback ("snmsg" → "sign message").
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti += 1) {
        if (text[ti] === query[qi]) qi += 1;
    }
    if (qi === query.length) return 200 - text.length * 0.1;

    return 0;
}

/**
 * Best score for a command across its searchable fields. Title carries
 * full weight; keywords and subtitle are discounted so a title hit always
 * outranks a keyword-only hit on another command.
 *
 * @param {string} query   lowercased, trimmed search string
 * @param {Command} command
 * @returns {number} 0 when the command does not match at all
 */
export function scoreCommand(query, command) {
    if (!query) return 1;
    let best = scoreText(query, command.title);
    for (const kw of command.keywords || []) {
        best = Math.max(best, scoreText(query, kw) * 0.6);
    }
    if (command.subtitle) {
        best = Math.max(best, scoreText(query, command.subtitle) * 0.4);
    }
    return best;
}

/**
 * Filter + rank a command list against a query. An empty/whitespace query
 * returns every command in its original (category) order so the palette
 * opens as a browsable catalogue. A non-empty query drops non-matches and
 * sorts by descending score, breaking ties by original order so the result
 * order is stable across renders.
 *
 * @param {Command[]} commands
 * @param {string} rawQuery
 * @returns {Command[]}
 */
export function filterCommands(commands, rawQuery) {
    const query = (rawQuery || '').trim().toLowerCase();
    if (!query) return commands.filter((c) => !c.disabled);

    const scored = [];
    for (let i = 0; i < commands.length; i += 1) {
        const command = commands[i];
        if (command.disabled) continue;
        const score = scoreCommand(query, command);
        if (score > 0) scored.push({ command, score, order: i });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));
    return scored.map((s) => s.command);
}
