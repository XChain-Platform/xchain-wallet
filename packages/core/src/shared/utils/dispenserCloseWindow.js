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
// window, and the indexer closes the dispenser at the first block whose
// protocol time is strictly later than the cancel's block time plus the
// window. On testnet that protocol time is the median of the previous eleven
// block stamps, which can trail the wall clock by half an hour or more, so the
// countdown runs on the chain's own time whenever the wallet can read it and
// falls back to the wall clock only when it cannot. Nothing closes until a
// block arrives, so the time computed here is the EARLIEST the close can land.

// Close window length in seconds; mirrors the indexer's DISPENSER_CLOSE_DELAY.
export const DISPENSER_CLOSE_DELAY_SECONDS = 3600;

// How often a page showing a countdown re-reads the chain's protocol time.
// Between reads the countdown advances it by local elapsed time.
export const CHAIN_TIME_REFRESH_MS = 5 * 60 * 1000;

// Under this many seconds left, a minute count reads as false precision.
const FEW_MINUTES_SECONDS = 5 * 60;

/**
 * The earliest close time of a cancelling dispenser and a plain countdown.
 *
 * With `chainTime` (the protocol time the next block will carry) and
 * `chainTimeReadAtMs` (the local clock when it was read), the remainder is
 * `closeAt - chainNow`, where chainNow is chainTime advanced by the local time
 * elapsed since the read. The local clock label is then now plus that
 * remainder. Without a usable chain time the remainder is measured against
 * the wall clock instead.
 *
 * @param {number|string|null|undefined} cancelTimestamp  the cancel action's block time, UNIX seconds
 * @param {{ nowMs?: number, delaySeconds?: number,
 *           chainTime?: number|null, chainTimeReadAtMs?: number|null }} [opts]
 * @returns {null | {
 *   closeAt: number,        earliest close in chain time, UNIX seconds
 *   closeAtMs: number,      local clock estimate of the close, milliseconds
 *   secondsLeft: number,    0 once the window has passed
 *   pastDue: boolean,       the window has passed and the close waits on a block
 *   basis: 'chain'|'clock', which clock the remainder was measured against
 *   countdown: string,      'about 23 minutes' | 'a few minutes' | 'at the next block' | 'any block now'
 *   shortCountdown: string, '~23 min' | 'a few min' | 'next block' | 'any block now'
 * }} null when the timestamp is missing or unreadable
 */
export function dispenserCloseEta(cancelTimestamp, opts = {}) {
    const {
        nowMs = Date.now(), delaySeconds = DISPENSER_CLOSE_DELAY_SECONDS,
        chainTime = null, chainTimeReadAtMs = null,
    } = opts;
    // Reject blank, zero and non-numeric stamps: a zero block time is a row
    // with no block behind it, and would read as a close fifty years overdue.
    if (cancelTimestamp == null || cancelTimestamp === '') return null;
    const cancelAt = Number(cancelTimestamp);
    if (!Number.isFinite(cancelAt) || cancelAt <= 0) return null;
    const closeAt = cancelAt + delaySeconds;
    const chainNow = chainNowSeconds(chainTime, chainTimeReadAtMs, nowMs);
    const basis = chainNow == null ? 'clock' : 'chain';
    const measuredFrom = chainNow == null ? nowMs / 1000 : chainNow;
    const secondsLeft = Math.max(0, Math.ceil(closeAt - measuredFrom));
    const pastDue = secondsLeft === 0;
    return {
        closeAt,
        closeAtMs: basis === 'chain' ? nowMs + secondsLeft * 1000 : closeAt * 1000,
        secondsLeft,
        pastDue,
        basis,
        countdown: countdownPhrase(secondsLeft, basis),
        shortCountdown: shortCountdownPhrase(secondsLeft, basis),
    };
}

// The chain's protocol time now: the last read, advanced by the local time
// since it. Elapsed time never counts backwards, so a local clock stepping
// back cannot push the close further out than the read itself did. Null when
// either input is unusable, which sends the caller to the wall clock.
function chainNowSeconds(chainTime, readAtMs, nowMs) {
    if (chainTime == null || readAtMs == null) return null;
    const base = Number(chainTime);
    const readAt = Number(readAtMs);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(readAt)) return null;
    return base + Math.max(0, nowMs - readAt) / 1000;
}

/**
 * The chain-time pair a countdown needs, from a `getChainTipBlockTime` result
 * read with `withProtocolTime`.
 *
 * @param {any} tipRead  `{ protocolTime }` from the chain tip read
 * @param {number} readAtMs  local clock when the read answered
 * @returns {null | { chainTime: number, chainTimeReadAtMs: number }}
 */
export function chainClockFromTipRead(tipRead, readAtMs) {
    const t = Number(tipRead?.protocolTime);
    if (tipRead?.protocolTime == null || !Number.isFinite(t) || t <= 0) return null;
    return { chainTime: t, chainTimeReadAtMs: readAtMs };
}

function countdownPhrase(secondsLeft, basis) {
    // Past the window there is no clock time left to count down to: by chain
    // time the next block closes it; by the wall clock alone the chain may
    // still be short of the window's end, so no single block is promised.
    if (secondsLeft <= 0) return basis === 'chain' ? 'at the next block' : 'any block now';
    if (secondsLeft < FEW_MINUTES_SECONDS) return 'a few minutes';
    const minutes = Math.round(secondsLeft / 60);
    if (minutes < 90) return `about ${minutes} minutes`;
    return `about ${Math.round(minutes / 60)} hours`;
}

function shortCountdownPhrase(secondsLeft, basis) {
    if (secondsLeft <= 0) return basis === 'chain' ? 'next block' : 'any block now';
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
