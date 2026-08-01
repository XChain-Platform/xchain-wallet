// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-161: a dispenser's ALLOW_LIST gates TWO addresses, not one.
//
// `dispense.js` checks the list against the payer (`SOURCE`) AND the
// dispenser's own pay-to address (`GET_ADDRESS`) on every fill, and refuses
// with `invalid: GET_ADDRESS (dispenser allow list)` when the owner is absent.
// The wallet's create form calls the control "Restrict who can buy", which is
// the reading that produces the mistake: a seller lists their customers, opens
// the dispenser, and it refuses every one of them.
//
// The cost lands on the BUYERS. A dispenser is triggered by a bare coin
// payment, so the coin has moved before the gate runs and a refusal does not
// return it - measured on Litecoin regtest 2026-07-31, DISPENSE 1997.
//
// The wallet already holds everything needed to see this coming: the list
// picker reads each list's members to show a count. This is that read, asked a
// different question.
//
// D-162 added the BUYER's side of the same gate. The buy panel already warns
// that a dispenser is "restricted" and names the list, and then tells the buyer
// to "check you are on the right side of the list before sending" - which is
// work the wallet can simply do. Two verdicts it can reach, and only one of
// them depends on who pays:
//   - the dispenser's own address is off its allow-list, so it sells to NOBODY
//     (the D-161 trap, seen from the other side of the trade)
//   - none of this wallet's addresses on the chain would be accepted

/**
 * The addresses a LIST action currently holds, or null when the shape carries
 * no member array at all (an older host build, or a read that failed).
 *
 * Tolerant of naming for the same reason `ListPickerScreen` is: the explorer's
 * action-data shape exposes members as `list`, and older/other shapes have used
 * `items` and `members`. A null means "unknown", which callers must treat
 * differently from "empty" - an empty list gates nothing, an unknown one must
 * not produce a warning the user cannot act on.
 *
 * @param {unknown} detail   a LIST action's detail row
 * @returns {string[] | null}
 */
export function listMembers(detail) {
    if (!detail || typeof detail !== 'object') return null;
    const d = /** @type {any} */ (detail);
    const rows = d.list ?? d.items ?? d.members;
    if (!Array.isArray(rows)) return null;
    return rows
        .map((row) => (row && typeof row === 'object'
            ? String(row.address ?? row.item ?? '')
            : String(row ?? '')))
        .filter(Boolean);
}

/**
 * Whether binding `members` as a dispenser's ALLOW_LIST would refuse every
 * buyer because the dispenser's own pay-to address is not on it.
 *
 * Returns false whenever the answer is not KNOWN - no list bound, members
 * unreadable, or no pay-to address resolved yet - because this drives a warning
 * and a warning shown on a failed read is worse than no warning at all: it
 * teaches the user to ignore it.
 *
 * An EMPTY list is deliberately not a hit either. `dispense.js` only consults a
 * list when it has entries (`if(dispenserAllowList.length)`), so an empty one
 * gates nothing and refuses nobody.
 *
 * @param {{ members: string[] | null | undefined, getAddress: string | null | undefined }} args
 * @returns {boolean}
 */
export function ownerOffAllowList({ members, getAddress }) {
    if (!Array.isArray(members) || members.length === 0) return false;
    const addr = typeof getAddress === 'string' ? getAddress.trim() : '';
    if (!addr) return false;
    return !members.includes(addr);
}

/**
 * What a dispenser's lists say about a set of addresses one WALLET holds, from
 * the buyer's side of the same gate.
 *
 * The buy panel's problem is not the seller's: a coin-paid dispenser is
 * triggered by a bare payment that can come from anywhere, so the wallet cannot
 * know which address will pay. What it CAN answer is the question a buyer is
 * actually asking - "will paying from this wallet work?" - and it answers it
 * for all of the wallet's addresses on the chain at once.
 *
 * Verdicts, and each maps to a different sentence because each has a different
 * remedy:
 *   'unknown'   nothing readable (no lists, an unread list, no addresses)
 *   'ok'        at least one address of this wallet would be accepted
 *   'refused'   every address of this wallet is off the allow-list or on the
 *               block-list, so a payment from here is refused and kept
 *   'partial'   some addresses would be accepted and some refused, which is
 *               worth naming because the wallet picks the payer, not the user
 *
 * @param {{
 *   addresses: string[],
 *   allowMembers?: string[] | null,
 *   blockMembers?: string[] | null,
 * }} args
 * @returns {{ verdict: 'unknown'|'ok'|'refused'|'partial', accepted: string[], refused: string[] }}
 */
export function buyerListVerdict({ addresses, allowMembers, blockMembers }) {
    const mine = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
    const allow = Array.isArray(allowMembers) && allowMembers.length ? allowMembers : null;
    const block = Array.isArray(blockMembers) && blockMembers.length ? blockMembers : null;
    if (mine.length === 0 || (!allow && !block)) {
        return { verdict: 'unknown', accepted: [], refused: [] };
    }
    const accepted = [];
    const refused = [];
    for (const addr of mine) {
        const barred = (allow && !allow.includes(addr)) || (block && block.includes(addr));
        (barred ? refused : accepted).push(addr);
    }
    if (accepted.length === 0) return { verdict: 'refused', accepted, refused };
    if (refused.length === 0) return { verdict: 'ok', accepted, refused };
    return { verdict: 'partial', accepted, refused };
}

/**
 * The sentence to show when `ownerOffAllowList` is true.
 *
 * Names the consequence and who pays it, because "add yourself to the list" on
 * its own reads like a formality: the failure is total (every fill), silent
 * (the dispenser looks open) and costs the BUYER, not the seller.
 *
 * @param {string} getAddress
 * @returns {string}
 */
export function ownerOffAllowListMessage(getAddress) {
    const shown = getAddress.length > 16
        ? `${getAddress.slice(0, 8)}…${getAddress.slice(-6)}`
        : getAddress;
    return `This dispenser's own address (${shown}) is not on the allow-list, and the network `
        + 'checks it as well as the buyer. Every purchase would be refused, and a buyer only finds '
        + 'out after paying, because the coin is sent before the check runs. Add this address to '
        + 'the list, or clear the list.';
}

/**
 * The buyer-side sentence for a `buyerListVerdict`, or null when there is
 * nothing worth saying.
 *
 * Says what happens to the MONEY in every case it speaks, because that is what
 * separates this from the generic "this dispenser is restricted" line the panel
 * already carries: the payment is not bounced, it is spent and kept.
 *
 * @param {{ verdict: string, accepted: string[], refused: string[] }} v
 * @returns {string | null}
 */
export function buyerListMessage(v) {
    if (!v) return null;
    if (v.verdict === 'refused') {
        return 'None of this wallet\'s addresses on this chain are allowed to buy from this '
            + 'dispenser. A payment from here would be refused and the coin is not returned.';
    }
    if (v.verdict === 'partial') {
        return `Only ${v.accepted.length} of this wallet's ${v.accepted.length + v.refused.length} `
            + 'addresses on this chain are allowed to buy from this dispenser. Pay from one of '
            + 'those: a payment from any of the others is refused and the coin is not returned.';
    }
    return null;
}

/**
 * The buyer-side sentence for a dispenser whose OWN pay-to address is off its
 * own allow-list - the D-161 trap, seen from the other side of the trade.
 *
 * Worth its own line because it is the one verdict that does not depend on who
 * pays: nobody can buy from this dispenser, so no amount of checking your own
 * membership helps.
 *
 * @returns {string}
 */
export function dispenserRefusesEveryoneMessage() {
    return 'This dispenser cannot sell to anyone: its own pay-to address is missing from the '
        + 'allow-list it was opened with, and the network checks that as well as the buyer. Every '
        + 'payment would be refused, and the coin is not returned. Only its owner can fix it.';
}
