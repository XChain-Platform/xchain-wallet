// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A form's own check at Approve that stops the signature (the token moved
// since review, say). Its message is the wallet's sentence and names the next
// step; submitFailureMessage shows it as written, where an unnamed error falls
// to the generic "Something went wrong" line.

export const APPROVE_REFUSAL_NAME = 'ApproveRefusalError';

/**
 * @param {string} message  the wallet's sentence, shown as written
 * @returns {Error}
 */
export function approveRefusal(message) {
    const err = new Error(message);
    err.name = APPROVE_REFUSAL_NAME;
    return err;
}
