// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The swap facts My Swaps and Swap Details share: reading explorer rows, the
// side text, the live state block, the derived status and the expiry line.
//
// Status derivation: a single swap's state.status does NOT promptly reflect
// a cancel, so "cancelled" is read from the authoritative and immediate
// swap_cancels feed. The list feed carries lifecycle as `swap_status` and
// swapsForAddress overlays the owner's edits as `state`; the action detail
// carries the same `state` block plus the chain-clock expiry classification.

import { countdownText } from '../../market/obligationStatus.js';
import { formatLocalDateTime } from './dateTime.js';

/** The list rows of an explorer response, dropping null or scalar entries. */
export function extractRows(resp) {
    let rows = [];
    if (Array.isArray(resp)) rows = resp;
    else if (Array.isArray(resp?.data)) rows = resp.data;
    else if (Array.isArray(resp?.rows)) rows = resp.rows;
    else if (Array.isArray(resp?.swaps)) rows = resp.swaps;
    // A null or scalar entry from the explorer would throw while reading a row field.
    return rows.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
}

/** One side of a swap as display text: an amount and its unit, or an ownership transfer. */
export function sideLabel(tick, coin, amount, ownership) {
    if (Number(ownership) === 1) return `ownership of ${tick || '?'}`;
    const unit = tick || coin || '';
    return `${amount ?? ''} ${unit}`.trim();
}

export const isPositiveActionIndex = (value) => /^[1-9][0-9]*$/.test(String(value ?? ''));

/** The live state block of a swap row or action detail, or null when it has none. */
export function swapStateOf(detail) {
    const state = detail?.state || detail?.data?.state;
    if (!state || typeof state !== 'object') return null;
    return {
        status: String(state.status || ''),
        expiration: state.expiration ?? null,
        ...(state.expiry_status != null ? { expiryStatus: state.expiry_status } : {}),
    };
}

/**
 * @param {{ key: string, row: any, live?: any }} item
 * @param {Set<string>} cancelledKeys
 * @param {number} nowSec
 */
export function deriveStatus(item, cancelledKeys, nowSec) {
    if (cancelledKeys.has(item.key)) return 'cancelled';
    if (String(item.row.status || 'valid') !== 'valid') return 'invalid';
    const swapStatus = String(item.live?.status || item.row.swap_status || '').toLowerCase().trim();
    if (swapStatus === 'complete' || swapStatus === 'filled' || swapStatus === 'settled') return 'settled';
    if (swapStatus === 'cancelled') return 'cancelled';
    if (swapStatus === 'expired') return 'expired';
    if (item.live?.expiryStatus === 'expired') return 'expired';
    if (item.live?.expiryStatus != null) return 'open';
    const exp = Number(item.live?.expiration ?? item.row.expiration);
    if (Number.isFinite(exp) && exp > 0 && exp <= nowSec) return 'expired';
    return 'open';
}

// A cancel row only cancels its swap when the indexer marked the cancel
// itself valid; an invalid SWAP cancel action leaves the swap open.
export function collectCancelledKeys(results) {
    const keys = new Set();
    for (const r of results) {
        for (const c of r.cancels) {
            if (String(c.status || 'valid') !== 'valid') continue;
            if (String(c.source) === r.p.owner.address) {
                keys.add(`${r.p.chainId}:${c.swap_action_index}`);
            }
        }
    }
    return keys;
}

/** A Unix-seconds expiration as a local date and time, or null when it is not one. */
export function fmtDate(unixSec) {
    const n = Number(unixSec);
    // Protocol expirations are Unix seconds. A current millisecond timestamp
    // otherwise renders as a plausible date tens of thousands of years away.
    if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000_000) return null;
    return formatLocalDateTime(n);
}

export function swapExpiryLabel(unixSec, nowSec) {
    const absolute = fmtDate(unixSec);
    if (!absolute) return null;
    const secondsLeft = Math.floor(Number(unixSec) - Number(nowSec));
    if (!Number.isFinite(secondsLeft)) return `Expires ${absolute}`;
    if (secondsLeft <= 0) return `Expired ${absolute}`;
    const days = Math.floor(secondsLeft / 86400);
    const countdown = days > 0
        ? `${days}d ${Math.floor((secondsLeft % 86400) / 3600)}h`
        : countdownText(secondsLeft);
    return countdown ? `Expires ${absolute} (${countdown} left)` : `Expires ${absolute}`;
}

/** Give and get as display text for a swap row or detail. */
export function swapSides(row) {
    return {
        give: sideLabel(row?.give_tick, row?.give_coin, row?.give_amount, row?.give_ownership),
        get: sideLabel(row?.get_tick, row?.get_coin, row?.get_amount, row?.get_ownership),
    };
}
