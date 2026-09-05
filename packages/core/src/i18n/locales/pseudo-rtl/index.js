// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pseudo-RTL developer locale (§54 / G174 FOLLOWUP 3).
//
// Not a real translation. It derives from the English dictionary at
// module load and wraps every value so a developer can switch to it and
// exercise the whole UI under `dir="rtl"`:
//
//   - a leading RIGHT-TO-LEFT MARK (U+200F) nudges bidi ordering so
//     mixed Latin/number copy lays out the way real RTL copy would;
//   - MATHEMATICAL WHITE SQUARE BRACKETS (U+27E6 / U+27E7) wrap each
//     string so clipped, concatenated, or hard-coded (un-t()-ed)
//     strings are obvious at a glance.
//
// ICU placeholders (`{name}`, `{count, plural, …}`) are left untouched
// inside the brackets so formatjs still parses and interpolates them.
//
// `getDirection('pseudo-rtl')` returns 'rtl' (see i18n/index.js), so
// registering + selecting this locale flips `document.documentElement`
// to `dir="rtl"` with no other wiring. It is discovered automatically by
// the lazy locale loader alongside the real locales.

import { en } from '../en/index.js';

const OPEN = '‏⟦'; // RIGHT-TO-LEFT MARK + ⟦
const CLOSE = '⟧'; // ⟧

/** Wrap one English value for pseudo-RTL display. */
function pseudo(value) {
    return `${OPEN}${value}${CLOSE}`;
}

const dict = {};
for (const [key, value] of Object.entries(en)) {
    dict[key] = pseudo(value);
}

export default dict;
