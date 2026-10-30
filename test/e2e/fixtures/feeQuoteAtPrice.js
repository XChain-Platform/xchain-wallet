// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A venue's native-fee quote, revalued at a different coin price.
//
// The native fee is an XCHAIN amount valued in the coin, so every coin amount
// in a quote moves by the inverse of the coin price and nothing else in it
// changes. A spec that needs the price at compose to differ from the price at
// Approve on a venue whose oracle it cannot write (the price seed stands aside
// for a live oracle) serves the venue's own quotes through this while it
// composes, then lets the Approve-time re-quote reach the venue unchanged.

const SATS_PER_COIN = 100_000_000;

const toSats = (decimal) => Math.round(Number(decimal) * SATS_PER_COIN);
const toDecimal = (sats) => (sats / SATS_PER_COIN).toFixed(8);

/**
 * The quote as the venue would answer it with the coin priced `factor` times
 * higher, or null when the quote prices nothing (invalid, busy, unsupported or
 * zero-fee), which the caller passes through as it came.
 *
 * Every coin amount scales by 1 / factor (expected, both band edges, the sats
 * twins); identity fields (coin, destination, round, block, status) are kept.
 * The band edges round inward, so the revalued band is never wider than the
 * exact one.
 *
 * @param {Record<string, unknown> | null | undefined} quote  a /feequote answer
 * @param {number} factor  coin price multiple, greater than zero
 * @returns {Record<string, unknown> | null}
 */
export function feeQuoteAtCoinPriceFactor(quote, factor) {
    if (!(Number(factor) > 0)) throw new Error(`coin price factor must be positive, got ${factor}`);
    if (!quote || typeof quote !== 'object' || quote.valid !== true) return null;
    const sats = Number(quote.requiredFeeSats);
    if (!Number.isSafeInteger(sats) || sats <= 0) return null;
    const minSats = toSats(quote.minAcceptable);
    const maxSats = toSats(quote.maxAcceptable);
    if (!Number.isFinite(minSats) || !Number.isFinite(maxSats)) return null;

    const scaled = Math.round(sats / factor);
    const scaledMin = Math.ceil(minSats / factor);
    const scaledMax = Math.floor(maxSats / factor);
    return {
        ...quote,
        ...(quote.coinUsdPrice != null
            ? { coinUsdPrice: (Number(quote.coinUsdPrice) * factor).toFixed(8) } : {}),
        expectedNative: toDecimal(scaled),
        requiredFeeNative: toDecimal(scaled),
        requiredFeeSats: scaled,
        requiredFeeSatsExact: String(scaled),
        minAcceptable: toDecimal(scaledMin),
        maxAcceptable: toDecimal(scaledMax),
    };
}
