// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet and account names: the shared length cap, the visible-text check and
// the key two names are compared by. A name made only of zero-width, bidi or
// blank-glyph characters shows as nothing in every list and cannot be typed
// back into the remove confirmation, and a name that differs from another only
// by such characters reads as a duplicate to the user.

export const NAME_MAX_LENGTH = 64;

// Characters that draw no mark: format controls (zero-width space and joiners,
// bidi marks and overrides), separators, controls, and the blank-glyph letters
// Braille blank, Hangul fillers and Hangul half-width filler.
const INVISIBLE = /[\p{Cf}\p{Z}\p{Cc}\s⠀ᅟᅠㅤﾠ]/gu;

/** Length in characters (code points), not UTF-16 units. */
export const nameLength = (value) => Array.from(value).length;

/** True when the name has at least one character that draws a mark. */
export function hasVisibleText(name) {
    return typeof name === 'string' && name.replace(INVISIBLE, '').length > 0;
}

/** Comparison key: invisible characters dropped, canonical form, lower case. */
export function nameKey(name) {
    return String(name ?? '').replace(INVISIBLE, '').normalize('NFC').toLocaleLowerCase();
}
