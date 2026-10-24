// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BIDI_CONTROLS, BIDI_PLACEHOLDER, ZERO_WIDTH } from './textHardening.js';
import { MULTILINE_CONTROLS } from './actionTextSafety.js';

// Compose surfaces refuse unsafe message text through actionTextSafetyError
// with the 'Message' label. This module only neutralizes received text for
// display, using the same character classes that refusal checks.

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
        .replace(MULTILINE_CONTROLS, BIDI_PLACEHOLDER);
}
