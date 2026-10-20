// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { neutralizeControlText } from './textHardening.js';

const FALLBACK = 'not accepted by the network';

// Plain words for each per-item verdict the indexer records when it leaves an
// item out of a LIST create or edit (the TICK, ADDRESS and LIST item checks).
const ITEM_STATUS_TEXT = Object.freeze({
    'invalid: TICK (unknown)': 'token not found',
    'invalid: TICK (format)': 'not a valid token name',
    'invalid: ADDRESS (format)': 'not a valid address for this network',
    'invalid: LIST (unknown)': 'list not found',
    'invalid: LIST (type)': 'list holds a different kind of item',
    'invalid: LIST (union)': 'a combined list cannot hold another combined list',
});

/**
 * Say why the network left one list item out, in words a person reads.
 * An unrecognised verdict falls back to a generic phrase so a raw code never
 * reaches the visible text; callers keep the raw code for a tooltip.
 *
 * @param {unknown} status   the indexer's per-item status
 * @returns {string | null}  null when the item was accepted
 */
export function listItemStatusText(status) {
    if (status == null || status === '' || status === 'valid') return null;
    return ITEM_STATUS_TEXT[String(status)] ?? FALLBACK;
}

// Plain words for each verdict the indexer records on a whole LIST action
// (list.js and the list/ meta, share, transfer and union checks).
const LIST_STATUS_TEXT = Object.freeze({
    'invalid: VERSION (unknown)': 'unsupported list version',
    'invalid: TYPE (unknown)': 'unknown kind of list',
    'invalid: EDIT (unknown)': 'unknown kind of edit',
    'invalid: LIST_ACTION_INDEX (unknown)': 'the list it changes was not found',
    'invalid: LIST_ACTION_INDEX (not owner)': 'sent by an address that does not own the list',
    'invalid: LIST_ACTION_INDEX (bridge-owned)': 'the list is held by the bridge and cannot be changed',
    'invalid: LIST_ACTION_INDEX (type)': 'only token and address lists can be shared',
    'invalid: LIST_ACTION_INDEX (already shared)': 'the list is already shared',
    'invalid: LIST_ACTION_INDEX (list exceeds LIST_SHARE_MAX_MEMBERS)': 'the list is too long to share',
    'invalid: ITEM (no member list)': 'a combined list needs at least one list',
    'invalid: ITEM (union exceeds LIST_UNION_MAX_MEMBERS)': 'too many lists in a combined list',
    'invalid: ITEM (union exceeds LIST_SHARE_MAX_MEMBERS)': 'the combined list is too long',
    'invalid: ITEM (shared list exceeds LIST_SHARE_MAX_MEMBERS)': 'a shared list cannot grow this long',
    'invalid: SOURCE (sleeping)': 'the sending address is paused',
    'invalid: NAME (no change)': 'the name and description did not change',
    'invalid: DESTINATION (unresolvable ^id)': 'the new owner could not be found',
    'invalid: DESTINATION (format)': 'the new owner is not a valid address',
});

// Text fields the indexer checks with one shared rule set (meta_rules.js and
// the MEMO checks in list.js), and what each failed rule means.
const FIELD_TEXT = Object.freeze({ NAME: 'name', DESCRIPTION: 'description', MEMO: 'memo' });
const FIELD_REASON_TEXT = Object.freeze({
    format: 'is not in the right format',
    length: 'is too long',
    pipe: 'has a character that is not allowed (|)',
    semicolon: 'has a character that is not allowed (;)',
});

/**
 * Say what a whole list's status means, in words a person reads.
 * Never returns the raw verdict: an unrecognised one falls back to a
 * generic phrase, and the fee checks' free text reads as one fee phrase.
 *
 * @param {unknown} status   the indexer's status for a LIST action
 * @returns {string | null}  null when the list is valid or has no status
 */
export function listStatusText(status) {
    if (status == null) return null;
    const raw = String(status).trim();
    const lower = raw.toLowerCase();
    if (raw === '' || lower === 'valid') return null;
    if (lower === 'pending') return 'pending';
    const known = LIST_STATUS_TEXT[raw] ?? ITEM_STATUS_TEXT[raw];
    if (known) return known;
    const field = /^invalid:\s*([A-Z_]+)\s*\(([a-z]+)\)$/.exec(raw);
    if (field && FIELD_TEXT[field[1]] && FIELD_REASON_TEXT[field[2]]) {
        return `the ${FIELD_TEXT[field[1]]} ${FIELD_REASON_TEXT[field[2]]}`;
    }
    if (/^invalid:/i.test(raw) && /\b(fee|insufficient)\b/i.test(raw)) return 'the fee was not paid';
    return FALLBACK;
}

/**
 * The raw verdict, made safe for a tooltip, for anyone who needs the exact
 * code; undefined when there is nothing to explain.
 *
 * @param {unknown} status
 * @returns {string | undefined}
 */
export function listStatusTitle(status) {
    if (status == null) return undefined;
    const raw = neutralizeControlText(status);
    return raw === '' || raw.toLowerCase() === 'valid' ? undefined : raw;
}
