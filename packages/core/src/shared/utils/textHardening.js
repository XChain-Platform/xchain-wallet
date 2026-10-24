// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The general-purpose half of the neutralization
// `betOutcomeLabels.js` originally carried alone.
//
// Two call sites now need "strip the characters a signing screen should
// never render raw" without needing each other's extra rules: a bet
// outcome label additionally gets quote-normalized (it is spliced into a
// quoted span) and length-capped at a label's width, while a deep-link
// field (memo, tick, EXECUTE method/params) needs neither, since it is not
// wrapped in quotes and has no fixed on-screen width to protect. This
// module holds the part both share; `betOutcomeLabels.js` layers its own
// two rules on top and the deep-link boundary (`uri/xchainUri.js`'s
// `hardenUriIntentText`) uses this module directly.
//
// Mirrors xchain-sdk's decoder/hardening.js, which solves the same
// problem for the SDK's own describer output; core cannot import the SDK
// (core imports nothing from a shell, and the SDK is a shell-level
// dependency), so the neutralization is duplicated here rather than
// shared across the package boundary.

// U+202A-U+202E (LRE/RLE/PDF/LRO/RLO), U+2066-U+2069 (LRI/RLI/FSI/PDI),
// U+200E/U+200F (LRM/RLM). Mirrors the SDK's BIDI_CONTROLS.
export const BIDI_CONTROLS = /[\u061C\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

// Zero-width space/non-joiner/joiner, word joiner, BOM.
export const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

// Glyphs that draw nothing but are not whitespace: Braille blank, Hangul and
// Khmer fillers. Shown as the visible placeholder so a padded message cannot
// look empty.
export const BLANK_GLYPHS = /[\u2800\u115F\u1160\u17B4\u17B5\u3164\uFFA0]/g;

// Variation selectors other than the emoji pair, and tag characters: invisible
// and carrying no layout, so they are dropped like zero-width characters.
export const HIDDEN_MARKS = /[\u00AD\u034F\uFE00-\uFE0D\u{E0000}-\u{E007F}]/gu;

// C0/C1 controls, which would otherwise break the line the text sits on
// (a CRLF pair can fake a second line in a plain-text render).
export const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

// Visible stand-in for a removed bidi control, as the SDK uses.
export const BIDI_PLACEHOLDER = '\u2426'; // SYMBOL FOR SUBSTITUTE FORM TWO

/**
 * Neutralize one string for display on a signing-adjacent screen: bidi
 * overrides become a visible placeholder (never silently dropped - silent
 * stripping would let "evil<RLO>txt" read clean), zero-width characters
 * are dropped, C0/C1 controls become a space, and whitespace runs
 * (including the space a stripped control just left behind) collapse to
 * one. Optionally truncated to `maxLength` with a trailing ellipsis.
 *
 * @param {unknown} value
 * @param {{ maxLength?: number }} [opts]
 * @returns {string} the neutralized string, or '' for null/undefined
 */
export function neutralizeControlText(value, opts = {}) {
    if (value === null || value === undefined) return '';
    let s = String(value)
        .replace(BIDI_CONTROLS, BIDI_PLACEHOLDER)
        .replace(ZERO_WIDTH, '')
        .replace(HIDDEN_MARKS, '')
        .replace(BLANK_GLYPHS, BIDI_PLACEHOLDER)
        .replace(CONTROLS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const { maxLength } = opts;
    if (typeof maxLength === 'number' && s.length > maxLength) {
        s = `${s.slice(0, maxLength - 1)}…`;
    }
    return s;
}

// Characters that are invisible or reorder text: C0/C1 controls, zero-width
// characters, bidi marks, overrides and isolates, and the byte-order mark.
const INVISIBLE_RANGES = [
    [0x00, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2069], [0xFEFF, 0xFEFF],
];
// Characters that read as a space while being something else.
const SPACE_LIKE_RANGES = [
    [0xA0, 0xA0], [0x1680, 0x1680], [0x2000, 0x200A], [0x2028, 0x2029], [0x202F, 0x202F], [0x205F, 0x205F], [0x3000, 0x3000],
];
// Written as code point ranges so no invisible character sits in this source.
const escapeCodePoint = (n) => '\\u' + n.toString(16).padStart(4, '0');
const classOf = (ranges) => new RegExp(
    '[' + ranges.map(([from, to]) => escapeCodePoint(from) + (to > from ? '-' + escapeCodePoint(to) : '')).join('') + ']',
    'g',
);
const HIDDEN_TEXT_CHARS = classOf([...INVISIBLE_RANGES, ...SPACE_LIKE_RANGES]);
// Free text keeps its line breaks and tabs: those are layout, not a hidden difference.
const HIDDEN_TEXT_CHARS_KEEPING_LAYOUT = classOf([
    [0x00, 0x08], [0x0B, 0x0C], [0x0E, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2069], [0xFEFF, 0xFEFF],
]);

const spell = (ch) => `[U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`;

/**
 * Show a value exactly as it travels, for a screen where a hidden difference
 * would matter (a contract argument is compared byte for byte by the contract,
 * so `x<ZWSP>y` must not read as `xy`).
 *
 * `neutralizeControlText` makes text safe to render by dropping or collapsing
 * what a reader cannot see; this keeps every character and spells out the
 * ones that cannot be seen as `[U+XXXX]`. By default a single interior space
 * stays a space and any other run of spaces is spelled out too, because a
 * renderer collapses it to one. With `keepLayout` spaces, tabs and line breaks
 * stay as they are and only the characters that cannot be seen are spelled
 * out, for free text a contract stored.
 *
 * @param {unknown} value
 * @param {{ keepLayout?: boolean }} [opts]
 * @returns {string}
 */
export function revealHiddenText(value, { keepLayout = false } = {}) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (keepLayout) return text.replace(HIDDEN_TEXT_CHARS_KEEPING_LAYOUT, spell);
    return text
        .replace(HIDDEN_TEXT_CHARS, spell)
        .replace(/^ +| +$| {2,}/g, (run) => run.replace(/ /g, spell(' ')));
}
