// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-147: how many of a dispenser's five refills are already spent.
//
// A dispenser may be topped up at most MAX_REFILLS times; the next one is
// rejected on chain with `invalid: MAX_REFILLS (dispenser refill limit
// reached)` (xchain-indexer actions/dispenser.js, gated by
// dispenser_caps_activation.js - genesis-active on regtest, mainnet from the
// 2026-08-17 flag-day).
//
// The wallet used to keep no count at all and state the ceiling as policy copy,
// so an owner had no way to know they were on their sixth. That is not a
// cosmetic gap: the refill lane has no confirm screen and owes no protocol fee,
// so it runs NO network dry run, and the sixth refill was signed, broadcast,
// and shown a "Refill submitted" screen with a transaction id - for an action
// the chain always records invalid. The owner pays a miner fee and watches an
// escrow that never moves. Measured live: DISPENSER_EDIT 1683 on Litecoin
// regtest, `invalid: MAX_REFILLS`, against dispenser 1677 whose escrow stayed
// at 200.
//
// The count comes from the lifecycle events the detail page already loads, so
// this costs no extra request.

/** The consensus cap (xchain-indexer config.js MAX_REFILLS). */
export const MAX_REFILLS = 5;

function isPositive(v) {
    if (v == null || v === '') return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
}

function isBlank(v) {
    return v == null || v === '';
}

/**
 * Whether one DISPENSER_EDIT row is a REFILL rather than an expiration or
 * list change.
 *
 * Two rules, and which one applies depends on the explorer serving the venue:
 *
 *   - `give_escrow` present: exact. The field IS the refill amount, and the
 *     indexer charges a refill against the cap on exactly this test
 *     (`format==2 && GIVE_ESCROW > 0`).
 *   - `give_escrow` absent: inferred from the fields that ARE served. A v2 edit
 *     carries only give_escrow, expiration and the two list slots, so an edit
 *     that changes none of the latter three changed the escrow. This is what an
 *     explorer older than the field answers with, and it is why the count is
 *     labelled as approximate there rather than used to block a compose: a
 *     no-op edit would be miscounted as a refill, and over-counting would
 *     refuse a refill the chain would have taken.
 *
 * @param {object} row
 * @returns {boolean}
 */
export function isRefillEdit(row) {
    if (!row) return false;
    if ('give_escrow' in row) return isPositive(row.give_escrow);
    return isBlank(row.expiration) && isBlank(row.allow_list) && isBlank(row.block_list);
}

/**
 * Refills already spent on a dispenser, from its lifecycle events.
 *
 * Only VALID edits count: the chain charges the cap on what it accepted, so a
 * rejected sixth refill does not make a seventh any more doomed than it already
 * was, and counting it would leave an owner permanently one short.
 *
 * @param {Array<{ kind?: string, row?: object }>} lifecycle  events as DispenserDetail holds them
 * @returns {{ used: number, remaining: number, exact: boolean }}
 *   `exact` is false when the venue's explorer does not serve `give_escrow`, so
 *   the caller can soften its copy instead of blocking on an inferred number.
 */
export function refillsUsed(lifecycle) {
    const edits = (Array.isArray(lifecycle) ? lifecycle : [])
        .filter((e) => e && e.kind === 'edits' && e.row)
        .map((e) => e.row)
        .filter((row) => String(row.status || '') === 'valid');

    // One unserved row makes the whole count inferred: a mixed answer cannot
    // happen (the field is in the query or it is not), but reading it off the
    // rows rather than off a version flag means this needs no knowledge of
    // which explorer is in front of it.
    const exact = edits.length === 0 || edits.every((row) => 'give_escrow' in row);
    const used = edits.filter(isRefillEdit).length;
    return { used, remaining: Math.max(0, MAX_REFILLS - used), exact };
}

/**
 * The sentence the refill form shows about the ceiling.
 *
 * @param {{ used: number, remaining: number, exact: boolean }} count
 * @returns {string}
 */
export function refillCeilingMessage({ used, remaining, exact }) {
    if (remaining <= 0) {
        return `This dispenser has used all ${MAX_REFILLS} of its refills. The network rejects a `
            + `${MAX_REFILLS + 1}th, so a refill now would cost a transaction fee and add nothing `
            + 'to the escrow. Open a new dispenser instead.';
    }
    const counted = exact ? '' : ', counted from this dispenser\'s edit history, which this '
        + 'explorer serves without the refill amounts, so treat it as approximate';
    return `${used} of ${MAX_REFILLS} refills used, ${remaining} left${counted}. `
        + 'A refill also resets the per-fill dispense counter (1,000 dispenses per fill).';
}
