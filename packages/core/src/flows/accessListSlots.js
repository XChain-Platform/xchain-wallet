// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One LIST bound as both the allow-list and the block-list of a dispenser
// admits nobody: every address the allow-list accepts, the block-list refuses.
// The network accepts that pairing on a dispenser edit and a bound list can be
// replaced but never removed, so the edit form is the only place to stop it.

/**
 * Normalize a LIST action index for comparison: trimmed, and leading zeros
 * dropped so "0042" and "42" name the same list. Blank stays blank.
 *
 * @param {unknown} idx
 * @returns {string}
 */
function listKey(idx) {
    const s = idx == null ? '' : String(idx).trim();
    if (!/^\d+$/.test(s)) return s;
    return s.replace(/^0+(?=\d)/, '');
}

/**
 * Whether the allow-list and block-list slots name the same LIST. A blank
 * slot never matches, since "no list" is not a list.
 *
 * @param {{ allowList: unknown, blockList: unknown }} args
 * @returns {boolean}
 */
export function listInBothSlots({ allowList, blockList }) {
    const allow = listKey(allowList);
    const block = listKey(blockList);
    return allow !== '' && allow === block;
}

/**
 * The refusal an EDIT should show, or null. Reads the pair the dispenser will
 * hold afterwards (a blank slot keeps the list already bound), and speaks only
 * when the edit touches a list, so an expiration-only edit is never refused
 * over a pairing the user did not make here.
 *
 * @param {object} args
 * @param {string} args.allowList         the edit's new allow-list, blank for "unchanged"
 * @param {string} args.blockList         the edit's new block-list, blank for "unchanged"
 * @param {unknown} [args.currentAllowList]  the list bound now, if any
 * @param {unknown} [args.currentBlockList]  the list bound now, if any
 * @returns {string | null}
 */
export function editListConflict({ allowList, blockList, currentAllowList, currentBlockList }) {
    if (!allowList && !blockList) return null;
    const next = {
        allowList: allowList || listKey(currentAllowList),
        blockList: blockList || listKey(currentBlockList),
    };
    return listInBothSlots(next) ? listInBothSlotsMessage(next.allowList) : null;
}

/**
 * The refusal shown when `listInBothSlots` is true.
 *
 * @param {unknown} idx   the list index both slots name
 * @returns {string}
 */
export function listInBothSlotsMessage(idx) {
    return `List #${listKey(idx)} is set as both the allow-list and the block-list. `
        + 'Every address it allows it also blocks, so nobody could use this. '
        + 'Pick a different list for one of the two.';
}
