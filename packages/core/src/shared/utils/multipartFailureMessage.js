// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const RESUMABLE_MESSAGE = 'Your upload is saved under Unfinished uploads. '
    + 'Choose Continue to finish it without paying again.';

const FAILURE_MESSAGES = Object.freeze({
    MULTIPART_NOT_ACTIVE: ['Multi-part file publishing is not available on this network yet. Nothing was sent.', false],
    FILE_FUNDING_NOT_CONFIRMED: [RESUMABLE_MESSAGE, true],
    FILE_PIECE_NOT_INDEXED: [RESUMABLE_MESSAGE, true],
    FILE_MULTIPART_PENDING_TIMEOUT: [RESUMABLE_MESSAGE, true],
    FILE_MULTIPART_MISMATCH: ['The uploaded parts do not match the file manifest. This upload cannot finish, so publish the file again as a new upload.', false],
    FUNDING_OUTPUT_SPENT: ['A funding coin for a missing part has already been spent. Discard this upload.', false],
    RESUME_ORIGINAL_MISMATCH: ['Choose the same file you started this upload with.', false],
    RESUME_PLAN_MISMATCH: ['Choose the same file you started this upload with.', false],
    RESUME_SOURCE_MISMATCH: ['Continue this upload from the address that started it.', false],
    GATED_RESUME_KEY_MISMATCH: ["This wallet does not hold that gated pack's key.", false],
    GATED_PACK_KEY_MISSING: ["This wallet does not hold that gated pack's key.", false],
    GATED_PACK_KEY_HASH_MISMATCH: ["This wallet does not hold that gated pack's key.", false],
    FILE_UPLOAD_NOT_FOUND: ['This upload is no longer saved.', false],
});

/**
 * @param {unknown} err
 * @returns {{code: string, message: string, resumable: boolean} | null}
 */
export function multipartFailureMessage(err) {
    if (!err || typeof err !== 'object') return null;
    const code = /** @type {{code?: unknown}} */ (err).code;
    if (typeof code !== 'string') return null;
    const failure = FAILURE_MESSAGES[code];
    if (!failure) return null;
    return { code, message: failure[0], resumable: failure[1] };
}
