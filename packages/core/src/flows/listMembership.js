// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which members a LIST reference stands for, and who may edit it.
//
// Under list-edit resolution the network resolves a reference to a list to the
// newest valid edit in its chain, so every gate, dispenser, order, airdrop and
// callback that names the list uses that edit's members. The explorer's LIST
// detail row carries both: `list` is what the action was created with, and
// `state.current_list` is what a reference resolves to today. Reading `list`
// answers the wrong question for any list that has been edited.

/** Hops a parent walk may take before giving up (a guard, not a real depth). */
const MAX_PARENT_HOPS = 64;

/**
 * The members a reference to this LIST resolves to, as the raw array, or null
 * when the row carries no member array at all.
 *
 * Prefers `state.current_list`, which the explorer fills only while list-edit
 * resolution is active. An explorer that says resolution is off, or that
 * predates `state`, falls back to the created members, which is what a
 * reference uses there. The `items` and `members` names are older shapes of the
 * same field.
 *
 * @param {unknown} detail   a LIST action's detail row
 * @returns {unknown[] | null}
 */
export function currentListItems(detail) {
    if (!detail || typeof detail !== 'object') return null;
    const d = /** @type {any} */ (detail);
    const state = d.state && typeof d.state === 'object' ? d.state : null;
    // Use the resolved membership unless the explorer says resolution is off
    if (state && state.edit_resolution_active !== false && Array.isArray(state.current_list)) {
        return state.current_list;
    }
    const rows = d.list ?? d.items ?? d.members;
    return Array.isArray(rows) ? rows : null;
}

/**
 * How many members a reference to this LIST resolves to, or null when the row
 * carries no member array (a count the caller should leave off).
 *
 * @param {unknown} detail   a LIST action's detail row
 * @returns {number | null}
 */
export function currentListMemberCount(detail) {
    const rows = currentListItems(detail);
    return Array.isArray(rows) ? rows.length : null;
}

/**
 * The address that created the root of a list's edit chain, which is the only
 * address whose edits count once owner-only list edits activate.
 *
 * Walks `list_action_index` parents from `detail` up to the create, reading each
 * parent with `readList`. Returns null when any step cannot be read, so a caller
 * shows no owner claim rather than a wrong one.
 *
 * @param {{ detail: any, readList: (actionIndex: string) => Promise<any> }} args
 * @returns {Promise<string | null>}
 */
export async function findListOwner({ detail, readList }) {
    let row = detail;
    const seen = new Set();
    for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
        if (!row || typeof row !== 'object') return null;
        const parent = row.list_action_index;
        // A create carries no parent: its SOURCE owns the whole chain
        if (parent == null || parent === '') {
            return typeof row.source === 'string' && row.source ? row.source : null;
        }
        const key = String(parent);
        // Stop on a parent cycle, which only a malformed read can produce
        if (seen.has(key)) return null;
        seen.add(key);
        try {
            // eslint-disable-next-line no-await-in-loop
            row = await readList(key);
        } catch {
            return null;
        }
    }
    return null;
}
