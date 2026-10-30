// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { actionTextSafetyError, MAX_MEMO_BYTES } from './actionTextSafety.js';

// The chain's MEMO length ceiling, checked at the form so an overlong memo is
// refused before compose instead of by the pre-flight or, on the legacy lane,
// by the indexer after the fee is spent.

/**
 * Longest MEMO the indexer accepts, in UTF-8 bytes. Copied from xchain-indexer
 * src/config/token_limits.js (`config['MAX_MEMO_LENGTH'] = 250`); every action
 * handler there refuses a longer one with `invalid: MEMO (length)`, for
 * example src/actions/list.js validateFields. Change both together.
 */
export const MAX_MEMO_LENGTH = MAX_MEMO_BYTES;

/**
 * Hint under every optional Memo field. It replaced "Protocol rejects | or ;.",
 * which a tester read as an error on the Create List page; it keeps both
 * facts that line carried, plus the one a user most needs: anyone can read it.
 */
export const MEMO_HINT = 'A public note saved on the blockchain with this action. It cannot contain | or ;.';

/**
 * Size of text after the UTF-8 encoding used for transaction data.
 *
 * @param {string | null | undefined} value
 * @returns {number}
 */
export function utf8ByteLength(value) {
    return new TextEncoder().encode(String(value ?? '')).byteLength;
}

/**
 * The form error for a memo the chain would refuse as too long, or null when
 * it fits. Pass the memo exactly as it goes on the wire (the forms trim it),
 * since that is the text the indexer measures after UTF-8 encoding.
 *
 * @param {string | null | undefined} memo
 * @returns {string | null}
 */
export function memoLengthError(memo) {
    const safetyError = actionTextSafetyError(memo, 'Memo');
    if (safetyError) return safetyError;
    const bytes = utf8ByteLength(memo);
    if (bytes <= MAX_MEMO_LENGTH) return null;
    return `Memo is ${bytes} bytes; the network accepts at most ${MAX_MEMO_LENGTH} bytes.`;
}

// C0 and C1 control characters (NUL, tab, line breaks, escape and the rest) plus the
// bidirectional embedding and override marks U+202A-U+202E and U+2066-U+2069.
// A memo is public text shown on review screens and explorers: controls corrupt the
// pipe-delimited action line and an override reorders the text printed after it.
// Joiners, direction marks (U+200E, U+200F) and emoji sequences stay allowed.
const MEMO_UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/**
 * The form error for a memo holding control characters or text-direction
 * overrides, or null when it is clean. Pass the memo as it goes on the wire.
 *
 * @param {string | null | undefined} memo
 * @returns {string | null}
 */
export function memoCharacterError(memo) {
    if (!MEMO_UNSAFE_CHARS.test(String(memo ?? ''))) return null;
    return "A memo can't include control characters or text direction overrides.";
}
