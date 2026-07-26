// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bindingPoll (PC-42): pre-flight validation for a binding poll's callback
// fields, mirroring the indexer's own v0 rules (xchain-indexer/src/actions/
// vote.js) so a poll that cannot index never costs a transaction.
//
// A poll is binding the moment it names a CALLBACK_CONTRACT: finalization then
// calls a contract method with the result, turning a decided poll into an
// on-chain effect. That is the difference between an opinion and a treasury
// release, which is why the turnout floor below is enforced unconditionally.
//
// THE TURNOUT FLOOR IS DELIBERATELY STRICTER THAN THE CHAIN. From the
// VOTE_BINDING_MINIMUMS flag-day the protocol itself requires QUORUM and
// MIN_VOTERS >= 1 on every binding poll (the BonkDAO-class guard: a callback
// that can move contract-held value must never finalize off a handful of
// ballots by omission). Before that flag-day a binding poll without them is
// still protocol-valid - so this requirement is a WALLET policy, not a protocol
// mirror. Requiring it on both sides of the flag-day is always safe (a poll
// that satisfies the stricter rule is valid under the looser one) and spares
// users a poll that is legal today and unrepeatable after October. This is
// also why the rule lives here and not in the SDK builder, which non-wallet
// callers legitimately use to create pre-flag-day binding polls.
//
// Messages are user-facing: plain language, no wire field names.

/**
 * @typedef {Object} BindingPollFields
 * @property {string} [callbackContract]   contract's deploy action_index
 * @property {string} [callbackMethod]
 * @property {string} [callbackParams]     JSON array
 * @property {string} [callbackOn]         'pass' | 'always'
 * @property {string} [gasEscrow]
 * @property {string} [callbackDelayBlocks]
 * @property {string} [quorum]
 * @property {string} [minVoters]
 */

export const CALLBACK_ON_VALUES = Object.freeze(['pass', 'always']);

/** Indexer cap, matching ATTEST's. */
const METHOD_MAX_LENGTH = 64;

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Is this poll binding? A blank callback contract keeps it advisory and every
 * other callback field is then ignored by the network.
 *
 * @param {BindingPollFields} fields
 * @returns {boolean}
 */
export function isBindingPoll(fields) {
    return !isBlank(fields?.callbackContract);
}

/**
 * Every problem with a binding poll's fields, in the order a user would fix
 * them. Returns `[]` for an advisory poll (nothing to check) and for a valid
 * binding one.
 *
 * @param {BindingPollFields} fields
 * @returns {string[]}
 */
export function bindingPollErrors(fields) {
    if (!isBindingPoll(fields)) return [];
    const errors = [];

    const contract = String(fields.callbackContract).trim();
    if (!/^\d+$/.test(contract)) {
        errors.push('The contract to call must be a contract number (its deploy action index).');
    }

    if (isBlank(fields.callbackMethod)) {
        errors.push('Name the method the contract should run when the poll finishes.');
    } else if (String(fields.callbackMethod).trim().length > METHOD_MAX_LENGTH) {
        errors.push(`The method name is too long (limit ${METHOD_MAX_LENGTH} characters).`);
    }

    if (!isBlank(fields.callbackOn) && !CALLBACK_ON_VALUES.includes(String(fields.callbackOn).trim())) {
        errors.push('Choose when the call fires: only when the poll passes, or on every result.');
    }

    if (!isBlank(fields.callbackParams)) {
        let ok = false;
        try { ok = Array.isArray(JSON.parse(String(fields.callbackParams))); } catch { ok = false; }
        if (!ok) errors.push('Extra arguments must be a JSON list, for example ["treasury", 1000].');
    }

    if (!isBlank(fields.gasEscrow)) {
        const n = Number(String(fields.gasEscrow).trim());
        if (!Number.isFinite(n) || n < 0) {
            errors.push('The escrow that funds the call must be a non-negative amount.');
        }
    }

    if (!isBlank(fields.callbackDelayBlocks)) {
        const n = Number(String(fields.callbackDelayBlocks).trim());
        if (!Number.isInteger(n) || n < 0) {
            errors.push('The delay before the call runs must be a whole number of blocks, or left blank.');
        }
    }

    // The turnout floor. See the header: stricter than the chain by design.
    if (isBlank(fields.quorum)) {
        errors.push('A binding poll needs a quorum: the smallest share of the supply that must vote for the result to count.');
    } else {
        const q = Number(String(fields.quorum).trim());
        if (!Number.isFinite(q) || q <= 0 || q > 1) {
            errors.push('Quorum must be a share above 0 and no more than 1, e.g. 0.2 for 20%.');
        }
    }

    if (isBlank(fields.minVoters)) {
        errors.push('A binding poll needs a minimum number of voters (at least 1).');
    } else {
        const m = Number(String(fields.minVoters).trim());
        if (!Number.isInteger(m) || m < 1) {
            errors.push('The minimum number of voters must be a whole number of at least 1.');
        }
    }

    return errors;
}
