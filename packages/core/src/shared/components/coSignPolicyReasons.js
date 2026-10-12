// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Plain-language clauses for the co-sign policy evaluator's violation codes.
// Display only: the approval gate reads `policyOk`, never these words, and a
// code missing here falls back to a sentence that names no reason.

const POLICY_REASON_TEXT = Object.freeze({
    POLICY_ACTION_DENIED: 'this account is not allowed to make this kind of transaction',
    POLICY_DESTINATION_DENIED: "the recipient is not on this account's list of allowed recipients",
    POLICY_UNRESOLVED_DESTINATION:
        "the recipient is given as a short reference that can't be checked against this account's allowed recipients",
    POLICY_DESTINATION_UNENFORCEABLE:
        'this account only allows listed recipients, and this kind of transaction has no recipient that can be checked',
    POLICY_AMOUNT_EXCEEDED: "the amount is over this account's limit for a single transaction",
    POLICY_WINDOW_AMOUNT_EXCEEDED: "it would go over this account's spending limit for the current period",
    POLICY_WINDOW_COUNT_EXCEEDED:
        'this account has already made as many transactions as it is allowed for the current period',
    POLICY_UNBOUNDED_ACTION:
        "this account has spending limits, and the amount this transaction moves can't be measured against them",
    POLICY_AMOUNT_INVALID: 'the amount in the request is not a valid amount',
    POLICY_UNRESOLVED_TICK:
        "the token is named by a number that this account's limits can't match to a token name",
    POLICY_TICK_CASE_COLLISION:
        "this account's limits name the same token more than once in different capitalization, so it is unclear which limit applies",
});

/**
 * Why a co-sign request is outside the account policy, as a short clause for
 * the approval alert, or null when the code has no plain description (the
 * wallet's own fallback code, an unknown code, anything that is not a string).
 *
 * Never echoes its input: the raw code belongs in the technical details, not
 * in the sentence a signer reads.
 *
 * @param {string|null|undefined} code
 * @returns {string|null}
 */
export function describePolicyReason(code) {
    if (typeof code !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(POLICY_REASON_TEXT, code)
        ? POLICY_REASON_TEXT[code]
        : null;
}
