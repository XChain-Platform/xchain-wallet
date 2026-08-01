// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §3.6: the general-purpose half of the neutralization
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
export const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

// Zero-width space/non-joiner/joiner, word joiner, BOM.
export const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

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
        .replace(CONTROLS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const { maxLength } = opts;
    if (typeof maxLength === 'number' && s.length > maxLength) {
        s = `${s.slice(0, maxLength - 1)}…`;
    }
    return s;
}
