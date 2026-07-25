// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Block-height -> estimated wall-clock date. PC-01's Mint settings
// panel (ManageToken.jsx) uses this to caption MINT_START_BLOCK /
// MINT_STOP_BLOCK inputs with a rough "when", the same way TokenWizard's
// edition template lets an issuer type a block height without needing
// to do the math themselves.
//
// This is unlike a COINPAY obligation's `expiration`, which is a real
// UNIX timestamp the indexer stamps at match time (see coinpayExpiry.js).
// A MINT_START_BLOCK / MINT_STOP_BLOCK is a bare block height with no
// wall-clock component at all; the protocol only understands block
// order. Projecting it to a date is necessarily an estimate, built from
// the chain's current indexed height (`messaging.getIndexerWatermark`,
// the same read the History timeline uses for its Indexed stage) and
// the coin's target block interval. Real block times vary with
// hashrate/difficulty, and testnet/regtest chains in particular can run
// far faster or slower than their mainnet target, so every label here is
// prefixed "~" and callers should keep their own static hint text as a
// fallback when the estimate can't be computed.

/**
 * Target block interval per coin, in seconds. This is the protocol's
 * consensus difficulty-retarget target, not a live network average, so
 * it drifts from real-world timing exactly as much as the chain's actual
 * hashrate drifts from its retarget assumption.
 */
export const TARGET_BLOCK_SECONDS_BY_COIN = {
    bitcoin: 600,   // 10 minutes
    litecoin: 150,  // 2.5 minutes
    dogecoin: 60,   // 1 minute
};

/**
 * @param {string | null | undefined} coin   chain descriptor's `coin` (bitcoin / litecoin / dogecoin)
 * @returns {number | null}
 */
export function targetBlockSecondsForCoin(coin) {
    return (coin && TARGET_BLOCK_SECONDS_BY_COIN[coin]) || null;
}

/**
 * Estimate the wall-clock Date a target block height will be mined (or
 * was mined, for a height already in the past), projecting forward or
 * backward from the chain's current indexed height at its target block
 * interval.
 *
 * @param {object} args
 * @param {string | null | undefined} args.coin
 * @param {number | string | null | undefined} args.currentHeight
 * @param {number | string | null | undefined} args.targetBlock
 * @returns {Date | null}   null when any input is missing, the coin is unrecognized, or the numbers aren't finite
 */
export function estimateBlockDate({ coin, currentHeight, targetBlock }) {
    const seconds = targetBlockSecondsForCoin(coin);
    // Explicit null/undefined/empty-string rejection first: Number(null)
    // is 0 (finite), so the isFinite check alone would silently treat a
    // missing currentHeight as "chain tip is block 0" instead of
    // "unknown, don't estimate".
    if (currentHeight == null || currentHeight === '' || targetBlock == null || targetBlock === '') {
        return null;
    }
    const current = Number(currentHeight);
    const target = Number(targetBlock);
    if (!seconds || !Number.isFinite(current) || !Number.isFinite(target) || target <= 0) {
        return null;
    }
    const deltaMs = (target - current) * seconds * 1000;
    return new Date(Date.now() + deltaMs);
}

/**
 * Human-readable label for a target block height: an approximate
 * calendar date plus a relative "in about N days" / "about N days ago"
 * qualifier. Returns null when `estimateBlockDate` can't produce a date
 * so the caller falls back to its own static hint text.
 *
 * @param {object} args   same shape as `estimateBlockDate`
 * @returns {string | null}
 */
export function blockDateEstimateText(args) {
    const date = estimateBlockDate(args);
    if (!date || Number.isNaN(date.getTime())) return null;
    const dateText = date.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
    });
    return `~${dateText} (${relativeDayText(date)})`;
}

function relativeDayText(date) {
    const diffMs = date.getTime() - Date.now();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'about now';
    const abs = Math.abs(diffDays);
    const unit = abs === 1 ? 'day' : 'days';
    return diffDays > 0 ? `in about ${abs} ${unit}` : `about ${abs} ${unit} ago`;
}
