// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BIDI_CONTROLS, BIDI_PLACEHOLDER, ZERO_WIDTH } from './textHardening.js';

// Message bodies may contain ordinary layout whitespace. Other C0/C1 controls
// and invisible direction characters can make the displayed text disagree with
// what is sent or place address-like text in a misleading visual order.
const UNSAFE_MESSAGE_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069\u200E\u200F]/u;
const UNSAFE_VISIBLE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Reports characters that a compose surface must refuse before encryption.
 * Tabs and line breaks remain valid message formatting.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasUnsafeMessageCharacters(value) {
    return typeof value === 'string' && UNSAFE_MESSAGE_CHARACTERS.test(value);
}

/**
 * Makes hostile message text visually stable without changing stored or copied
 * plaintext. Direction controls become visible and zero-width characters are
 * removed. Ordinary tabs and line breaks remain intact.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function messageTextForDisplay(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(BIDI_CONTROLS, BIDI_PLACEHOLDER)
        .replace(ZERO_WIDTH, '')
        .replace(UNSAFE_VISIBLE_CONTROLS, BIDI_PLACEHOLDER);
}

