// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { neutralizeControlText } from './textHardening.js';

// (c): name a bet's outcome the way the market names it.
//
// A BET action carries the outcome as an INDEX, so everything derived from
// the composed bytes (sdk.decoder.describe, the confirm screen's intent
// line) can only say "outcome 0". That is the screen whose whole job is
// verifying intent, and a bettor checking they backed the right side should
// not have to map 0 to "Yes" themselves - especially on a resolve, which
// pays the pot out.
//
// The index is never replaced, only annotated: the number comes from the
// bytes that will broadcast, the label comes from the market row the
// explorer served. Two different sources, so both are shown and the label
// is quoted to mark where the untrusted half starts and ends.
//
// LABELS ARE ATTACKER-CONTROLLED. Anyone can open a market and name its
// outcomes, and those names land on a signing screen. The SDK hardens its
// own describer output (xchain-sdk decoder/hardening.js), but core cannot
// import the SDK (core imports nothing from a shell, and the SDK is a
// shell-level dependency), so the same neutralization is applied here for
// the strings this module splices in: bidi controls become a visible
// placeholder rather than silently vanishing, zero-width and control
// characters are dropped, runs of whitespace collapse, and a long label is
// truncated so it cannot push the rest of the sentence off the screen.

// The bidi/zero-width/control/whitespace half of that (everything except
// the quote rewrite and the length cap, which are specific to a label
// spliced into a quoted span of fixed width) is shared with the deep-link
// hardening this module's sibling added: see
// `shared/utils/textHardening.js`.

// Long enough for a real outcome name ("Home team wins in regulation"),
// short enough that a padded label cannot bury the market id after it.
const MAX_LABEL = 40;

/**
 * Neutralize one outcome label for display on a signing screen.
 *
 * @param {unknown} label
 * @returns {string} the display-safe label, or '' when nothing survives
 */
export function safeOutcomeLabel(label) {
    if (label === null || label === undefined) return '';
    // A quote inside the label would fake the end of the quoted span the
    // callers below wrap it in. Rewritten before the shared pass: quote
    // characters are untouched by bidi/zero-width/control/whitespace
    // matching, so doing it first or last is equivalent, and doing it
    // first keeps this function's only label-specific rule next to the
    // comment explaining it.
    const withoutQuotes = String(label).replace(/["“”]/g, "'");
    return neutralizeControlText(withoutQuotes, { maxLength: MAX_LABEL });
}

/**
 * The market's outcome labels, in wire order.
 *
 * The explorer serves the labels as `outcomes`, a comma-separated string in
 * the order BET format 0 declared them (the format rejects a comma inside a
 * label, so splitting is lossless). `outcome_labels` is accepted too because
 * the market detail route already hands some callers the split array.
 *
 * @param {any} feed  a bet_feeds row
 * @returns {string[]}
 */
export function outcomeLabelsOf(feed) {
    if (Array.isArray(feed?.outcome_labels)) return feed.outcome_labels.map((l) => String(l));
    if (typeof feed?.outcomes === 'string' && feed.outcomes !== '') return feed.outcomes.split(',');
    if (Array.isArray(feed?.outcomes)) return feed.outcomes.map((l) => String(l));
    return [];
}

/**
 * How an outcome reads mid-sentence: `"Yes" (outcome 0)`, falling back to
 * the bare `outcome 0` when this market has no usable label for that index.
 *
 * @param {string[]} labels
 * @param {number | string} index
 * @returns {string}
 */
export function outcomePhrase(labels, index) {
    const i = Number(index);
    const bare = `outcome ${index === null || index === undefined ? '?' : String(index)}`;
    if (!Array.isArray(labels) || !Number.isInteger(i) || i < 0 || i >= labels.length) return bare;
    const label = safeOutcomeLabel(labels[i]);
    if (!label) return bare;
    return `"${label}" (${bare})`;
}

/**
 * How an outcome reads as a value in a label/value row: `0 ("Yes")`.
 *
 * @param {string[]} labels
 * @param {number | string} index
 * @returns {string}
 */
export function outcomeValue(labels, index) {
    const i = Number(index);
    const bare = index === null || index === undefined ? '' : String(index);
    if (!Array.isArray(labels) || !Number.isInteger(i) || i < 0 || i >= labels.length) return bare;
    const label = safeOutcomeLabel(labels[i]);
    if (!label) return bare;
    return `${bare} ("${label}")`;
}

// The rows sdk.decoder.describe emits for the two BET formats that carry an
// outcome: place-bet (v2) and resolve (v3).
const OUTCOME_ROW_LABELS = new Set(['Outcome', 'Winning outcome']);

/**
 * Annotate a decoded action with the market's own outcome names.
 *
 * Takes the host-described intent (summary / details / warnings decoded from
 * the COMPOSED bytes) and returns a copy whose outcome index is named. The
 * decoded object comes back untouched when it carries no outcome row or when
 * this market has no label for that index, and the summary is rewritten only
 * where it states the SAME index the row does: a summary naming a different
 * outcome is not the action these labels describe, and annotating it anyway
 * is how a confirm screen starts lying.
 *
 * @param {{ summary?: string, details?: Array<{label: string, value: string}>, warnings?: string[] } | null} decoded
 * @param {string[]} labels  the market's outcome labels, in wire order
 * @returns {typeof decoded}
 */
export function withOutcomeLabels(decoded, labels) {
    if (!decoded || !Array.isArray(labels) || labels.length === 0) return decoded;
    const details = Array.isArray(decoded.details) ? decoded.details : [];
    const row = details.find((d) => d && OUTCOME_ROW_LABELS.has(d.label) && /^\d+$/.test(String(d.value ?? '')));
    if (!row) return decoded;

    const index = Number(row.value);
    const named = outcomeValue(labels, index);
    if (named === String(row.value)) return decoded;

    // Only the exact "outcome <index>" the row agrees with is rewritten, and
    // only once: a summary naming a different index is not this action.
    //
    // Replaced through a FUNCTION, never a replacement string: a label is
    // attacker-supplied text, and `$&` or `$1` inside one would otherwise be
    // expanded by replace() into whatever the pattern matched.
    const phrase = outcomePhrase(labels, index);
    const summary = typeof decoded.summary === 'string'
        ? decoded.summary.replace(new RegExp(`\\boutcome ${index}\\b`), () => phrase)
        : decoded.summary;

    return {
        ...decoded,
        summary,
        details: details.map((d) => (d === row ? { ...d, value: named } : d)),
    };
}
