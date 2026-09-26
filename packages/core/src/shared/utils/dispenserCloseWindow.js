// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// When a cancelling dispenser closes. A DISPENSER v1 cancel opens a close
// window, and the indexer closes the dispenser at the first block whose block
// time is strictly later than the cancel's block time plus the window. Off
// mainnet that block time is the median-time-past, which trails the wall
// clock, and nothing closes until a block arrives, so the time computed here
// is the EARLIEST the close can land, never a promise.

// Close window length in seconds; mirrors the indexer's DISPENSER_CLOSE_DELAY.
export const DISPENSER_CLOSE_DELAY_SECONDS = 3600;

// Under this many seconds left, a minute count reads as false precision.
const FEW_MINUTES_SECONDS = 5 * 60;

/**
 * The earliest close time of a cancelling dispenser and a plain countdown.
 *
 * @param {number|string|null|undefined} cancelTimestamp  the cancel action's block time, UNIX seconds
 * @param {{ nowMs?: number, delaySeconds?: number }} [opts]
 * @returns {null | {
 *   closeAt: number,        earliest close, UNIX seconds
 *   closeAtMs: number,      the same in milliseconds, for a local clock label
 *   secondsLeft: number,    0 once the window has passed
 *   pastDue: boolean,       the window has passed and the close waits on a block
 *   countdown: string,      'about 23 minutes' | 'a few minutes' | 'any block now'
 *   shortCountdown: string, '~23 min' | 'a few min' | 'any block now'
 * }} null when the timestamp is missing or unreadable
 */
export function dispenserCloseEta(cancelTimestamp, opts = {}) {
    const { nowMs = Date.now(), delaySeconds = DISPENSER_CLOSE_DELAY_SECONDS } = opts;
    // Reject blank, zero and non-numeric stamps: a zero block time is a row
    // with no block behind it, and would read as a close fifty years overdue.
    if (cancelTimestamp == null || cancelTimestamp === '') return null;
    const cancelAt = Number(cancelTimestamp);
    if (!Number.isFinite(cancelAt) || cancelAt <= 0) return null;
    const closeAt = cancelAt + delaySeconds;
    const secondsLeft = Math.max(0, Math.ceil(closeAt - nowMs / 1000));
    const pastDue = secondsLeft === 0;
    return {
        closeAt,
        closeAtMs: closeAt * 1000,
        secondsLeft,
        pastDue,
        countdown: countdownPhrase(secondsLeft),
        shortCountdown: shortCountdownPhrase(secondsLeft),
    };
}

function countdownPhrase(secondsLeft) {
    // Past the window the close needs a block with a later median time, so
    // there is no clock time left to count down to.
    if (secondsLeft <= 0) return 'any block now';
    if (secondsLeft < FEW_MINUTES_SECONDS) return 'a few minutes';
    const minutes = Math.round(secondsLeft / 60);
    if (minutes < 90) return `about ${minutes} minutes`;
    return `about ${Math.round(minutes / 60)} hours`;
}

function shortCountdownPhrase(secondsLeft) {
    if (secondsLeft <= 0) return 'any block now';
    if (secondsLeft < FEW_MINUTES_SECONDS) return 'a few min';
    const minutes = Math.round(secondsLeft / 60);
    if (minutes < 90) return `~${minutes} min`;
    return `~${Math.round(minutes / 60)} h`;
}

/**
 * The block time of the cancel that put one dispenser into its close window,
 * picked from the explorer's dispenser cancel rows.
 *
 * Only a valid cancel that names this dispenser counts: the feed also lists
 * refused cancel attempts, and a row with no dispenser index could belong to
 * any dispenser on the address. The newest one wins.
 *
 * @param {any[]} cancelRows  rows from the dispenser cancels feed
 * @param {string|number} actionIndex  the dispenser's action index
 * @returns {number|null} UNIX seconds, or null when no row qualifies
 */
export function dispenserCancelTimestamp(cancelRows, actionIndex) {
    if (!Array.isArray(cancelRows)) return null;
    let best = null;
    for (const row of cancelRows) {
        if (!row || row.dispenser_action_index == null) continue;
        if (String(row.dispenser_action_index) !== String(actionIndex)) continue;
        // Skip refused cancels; a row without a status predates the column.
        const status = String(row.status ?? 'valid').trim().toLowerCase();
        if (status !== 'valid') continue;
        const ts = Number(row.timestamp);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const height = Number(row.block_index ?? 0);
        if (!best || height > best.height || (height === best.height && ts > best.ts)) best = { ts, height };
    }
    return best ? best.ts : null;
}

/**
 * First six and last four characters of an address, for inline copy.
 *
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function shortAddress(address) {
    if (!address || typeof address !== 'string') return '';
    return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
