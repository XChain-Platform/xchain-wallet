// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Invisible format characters (zero-width space, joiners, soft hyphen, word
// joiner, directional marks) ride along when a phrase is copied from a web
// page or a chat app. They are not whitespace to the tokenizer, so one left in
// place turns a correct word into an unknown word the user cannot see.
const INVISIBLE_FORMAT_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064]/g;

/**
 * Normalize a recovery phrase for validation and storage. A complete,
 * sequential `1. word 2. word` structure is treated as display numbering;
 * other numeric tokens remain visible to validation as invalid input.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRecoveryPhrase(value) {
    if (typeof value !== 'string') return '';
    const tokens = value.replace(INVISIBLE_FORMAT_CHARS, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const isNumbered = tokens.length >= 2
        && tokens.length % 2 === 0
        && tokens.every((token, index) => (
            index % 2 === 1 || token === `${index / 2 + 1}.`
        ));
    const words = isNumbered
        ? tokens.filter((_, index) => index % 2 === 1)
        : tokens;
    return words.join(' ');
}
