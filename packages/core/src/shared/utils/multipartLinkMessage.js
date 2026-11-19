// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const LINK_TARGET_REASONS = Object.freeze([
    'not_indexed',
    'pending',
    'unreadable',
    'mismatch',
    'not_a_manifest',
    'no_link_target',
    'token_mismatch',
    'bad_index',
]);

const LINK_TARGET_MESSAGES = Object.freeze({
    not_indexed: Object.freeze([
        "The file's manifest is not indexed yet. The link review will open once it is indexed.",
        true,
    ]),
    pending: Object.freeze([
        'Not every part of the file is confirmed yet. The link review will open once the file is complete.',
        true,
    ]),
    unreadable: Object.freeze([
        "The file's state could not be read from the explorer. Try again in a moment.",
        true,
    ]),
    mismatch: Object.freeze([
        'The uploaded parts do not match the file manifest. '
            + 'This upload cannot finish, so publish the file again as a new upload.',
        false,
    ]),
    not_a_manifest: Object.freeze([
        'That transaction is not a multi-part file, so it cannot be linked as artwork.',
        false,
    ]),
    no_link_target: Object.freeze([
        'This upload was not started for a token, so there is nothing to link.',
        false,
    ]),
    token_mismatch: Object.freeze([
        'This upload was started for another token. Open that token to link it.',
        false,
    ]),
    bad_index: Object.freeze([
        'The file or token index could not be read, so the link was not built.',
        false,
    ]),
});

/**
 * @param {unknown} reason
 * @returns {{reason: string, message: string, retryable: boolean} | null}
 */
export function multipartLinkMessage(reason) {
    if (typeof reason !== 'string' || !Object.hasOwn(LINK_TARGET_MESSAGES, reason)) return null;
    const [message, retryable] = LINK_TARGET_MESSAGES[reason];
    return { reason, message, retryable };
}
