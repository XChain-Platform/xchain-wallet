// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// COINPAY obligation expiry rendering (§41.4).
//
// A coinpay obligation's `expiration` is a UNIX timestamp in seconds,
// not a block height: the indexer sets it to `BLOCK_TIME +
// COINPAY_EXPIRATION` (order_match.js), default a 2-hour window. The
// review + picker screens previously labelled it "Expires at block N",
// which is not just cosmetically wrong: the protocol warns that a
// COINPAY confirming after expiry loses the buyer's native coin with no
// settlement, so a user who reads a far-future "block" number can
// broadcast past the real 2-hour deadline and lose funds. Render it as
// an absolute UTC time instead.

/**
 * Human-readable expiry for a coinpay obligation.
 *
 * @param {unknown} expiration  UNIX timestamp in seconds
 * @returns {string | null}  e.g. "Tue, 08 Jul 2026 14:00:00 GMT", or
 *   null when the value is missing / not a sane timestamp.
 */
export function coinpayExpiryText(expiration) {
    const n = Number(expiration);
    // Reject non-finite, non-positive, and obviously-not-a-timestamp
    // values. Guard the upper bound too so a millisecond value (or
    // garbage) doesn't render a year-50000 date.
    if (!Number.isFinite(n) || n <= 0 || n > 1e13) return null;
    const d = new Date(n * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toUTCString();
}
