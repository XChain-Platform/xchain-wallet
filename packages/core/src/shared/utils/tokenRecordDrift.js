// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token form reads the token record once, when it opens, and gates and
// prefills from that copy for as long as it stays open. A lock, a pause, an
// ownership transfer or a settings edit that lands in the meantime (from
// another tab, another device or another wallet) leaves the form offering an
// action the chain now refuses, after the protocol fee is committed, or
// writing prefilled settings back over the newer values.
//
// `tokenRecordChangedSince` re-reads the record when the user presses Review
// and reports whether anything the form depends on moved. When it did, the
// cached copy is dropped so every mounted form refetches, and the caller asks
// the user to look at the updated details instead of composing against stale
// ones. A read that fails reports no change: the confirm page's pre-flight is
// the backstop, and an explorer hiccup must not block every action.

import { invalidateTokenInfo } from './tokenInfoCache.js';

/** Record fields that decide who may act and what a form prefills. */
export const TOKEN_RECORD_GATE_KEYS = Object.freeze([
    'creator',
    'locks',
    'divisibility',
    'maxSupply',
    'mintMax',
    'mintAddressMax',
    'mintStartBlock',
    'mintStopBlock',
    'callbackBlock',
    'callbackTick',
    'callbackAmount',
    'allowList',
    'blockList',
]);

function canonicalValue(key, value) {
    if (value === undefined || value === null || value === '') return null;
    if (key === 'locks' && typeof value === 'object') {
        return Object.keys(value).filter((k) => value[k]).sort();
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
}

/**
 * Whether two token records differ in any of `keys`. A missing side never
 * counts as a difference, so a record that has not loaded cannot trip it.
 *
 * @param {object | null | undefined} before
 * @param {object | null | undefined} after
 * @param {readonly string[]} [keys]
 * @returns {boolean}
 */
export function tokenRecordsDiffer(before, after, keys = TOKEN_RECORD_GATE_KEYS) {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
    return keys.some((key) => (
        JSON.stringify(canonicalValue(key, before[key])) !== JSON.stringify(canonicalValue(key, after[key]))
    ));
}

/**
 * Re-read a token and report whether it moved since `current` was read.
 *
 * @param {object} args
 * @param {{ getTokenInfo?: (req: object) => Promise<any> } | null} args.messaging
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.tick
 * @param {object | null | undefined} args.current   the record the form is using
 * @param {readonly string[]} [args.keys]            fields to compare
 * @returns {Promise<boolean>}
 */
export async function tokenRecordChangedSince({ messaging, chainId, tick, current, keys = TOKEN_RECORD_GATE_KEYS }) {
    if (!current || !chainId || !tick || typeof messaging?.getTokenInfo !== 'function') return false;
    let fresh;
    try {
        // Fresh: the form read this record moments ago, and a reused or
        // HTTP-cached answer would be that same record.
        fresh = await messaging.getTokenInfo({ chainId, tick, demo: false, fresh: true });
    } catch {
        return false;
    }
    if (!fresh || fresh.loadError) return false;
    if (!tokenRecordsDiffer(current, fresh, keys)) return false;
    invalidateTokenInfo(chainId, tick);
    return true;
}

/** The sentence a form shows when its token moved under it. */
export function tokenRecordChangedMessage(tick) {
    const name = String(tick || 'This token').trim() || 'This token';
    return `${name} changed since this form opened. Check the updated details, then review again.`;
}
