// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// COINPAY obligation status classification (§41.4 / PC-15).
//
// An obligation's `expiration` is a UNIX timestamp in seconds (block
// time + COINPAY_EXPIRATION, default 7200s; see coinpayExpiry.js).
// The protocol warns that a COINPAY confirming after that deadline
// loses the buyer's native coin with no settlement, so the queue UI
// needs a hard "expired: do not pay" state, plus an "at risk" band
// where the user should act immediately. The 30-minute at-risk
// threshold matches the PC-16 auto-pay retry cutoff (T-30min): past
// it, even a broadcast-now payment is racing block cadence.

/** Seconds before expiry at which an obligation is flagged at-risk. */
export const AT_RISK_SECONDS = 30 * 60;

/**
 * Classify a COINPAY obligation by its expiration.
 *
 * States:
 *   - 'open'    payable; `secondsLeft` > AT_RISK_SECONDS (or null when
 *               the row carries no usable expiration: no countdown is
 *               shown, but payment stays allowed, matching the
 *               pre-PC-15 CoinpayForm behavior for such rows).
 *   - 'at-risk' payable, but the deadline is close; act now.
 *   - 'expired' wall-clock deadline passed. Paying now risks a
 *               confirm-after-expiry, which burns the coin with no
 *               token settlement; the UI must not offer "Pay now".
 *
 * @param {unknown} expiration  UNIX timestamp in seconds
 * @param {number} [nowSeconds]  current time, UNIX seconds
 * @returns {{ state: 'open' | 'at-risk' | 'expired', secondsLeft: number | null }}
 */
export function classifyObligation(expiration, nowSeconds = Math.floor(Date.now() / 1000)) {
    const n = Number(expiration);
    // Same sanity window as coinpayExpiryText: reject non-finite,
    // non-positive, and millisecond-scale (or garbage) values.
    if (!Number.isFinite(n) || n <= 0 || n > 1e13) {
        return { state: 'open', secondsLeft: null };
    }
    const secondsLeft = Math.floor(n - nowSeconds);
    if (secondsLeft <= 0) return { state: 'expired', secondsLeft };
    if (secondsLeft <= AT_RISK_SECONDS) return { state: 'at-risk', secondsLeft };
    return { state: 'open', secondsLeft };
}

/**
 * Compact countdown label for a queue row: "2h 05m", "23m 45s",
 * "48s". Null when there is nothing sensible to count down to
 * (missing expiration, or already expired: the row shows its state
 * label instead of a negative timer).
 *
 * @param {number | null | undefined} secondsLeft
 * @returns {string | null}
 */
export function countdownText(secondsLeft) {
    if (!Number.isFinite(secondsLeft) || secondsLeft == null || secondsLeft <= 0) return null;
    const s = Math.floor(secondsLeft);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
}

/**
 * The base-unit value of a CoinPay obligation's `coin_amount`, whichever
 * shape the explorer served it in.
 *
 * THE TWO SHAPES ARE REAL, and assuming one of them broke the whole lane.
 * The indexer stores an obligation's COIN_AMOUNT as the match's own decimal
 * coin figure (`order_match.js`: `COIN_AMOUNT: nativeCoinAmount`) and the
 * explorer serves that column verbatim, so a 0.5 LTC debt arrives as `"0.5"`.
 * Every wallet reader assumed base units and rejected anything that was not
 * all digits, which was measured on Litecoin regtest 2026-07-29 to mean:
 * Payments due labelled the debt `0.5 base units` (a figure 100,000,000x
 * smaller than the truth, under the wrong unit); `autopayPolicy` cap 2
 * scored every obligation `amount-mismatch`, so auto-pay could never pay;
 * and `verifyCoinpayObligation` threw `unusable coin_amount`, so the manual
 * Pay path refused to sign. The lane could be entered and never settled.
 *
 * Accepts a plain integer (base units) or a plain decimal (coin units), and
 * NOTHING else - no hex, no octal, no exponent, no sign - because this feeds
 * a signing-path equality check where a lenient parse is a wrong payment.
 * A value with a fractional part is unambiguously coin units; a bare integer
 * stays base units, which is what every other caller of this module passes.
 *
 * @param {unknown} raw
 * @returns {bigint | null}
 */
export function obligationBaseUnits(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    if (m[2] === undefined) return BigInt(m[1]);
    if (m[2].length > 8) return null;
    return BigInt(m[1]) * 100000000n + BigInt(m[2].padEnd(8, '0'));
}

/**
 * Render a base-unit native-coin amount (8 decimals: BTC/LTC/DOGE) as
 * a decimal string at coin scale. BigInt throughout: a DOGE
 * obligation can exceed Number.MAX_SAFE_INTEGER, where
 * float math would display a *different amount than gets paid*.
 * Returns null for anything that is not a plain non-negative integer
 * shape; callers show the raw value with a "base units" label
 * instead of a wrong coin-scale number.
 *
 * @param {unknown} raw  base-unit amount (number or digit string)
 * @returns {string | null}
 */
export function baseUnitsToCoinText(raw) {
    if (raw == null || raw === '') return null;
    // Digit-shape guard before BigInt: BigInt() also accepts hex/octal
    // ("0x10" -> 16n), which is never a legitimate explorer amount.
    // Mirrors CoinpayForm's safeBaseUnitAmount.
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) return null;
    let v;
    try {
        v = BigInt(s);
    } catch {
        return null;
    }
    const intPart = v / 100000000n;
    const fracPart = v % 100000000n;
    if (fracPart === 0n) return String(intPart);
    const frac = String(fracPart).padStart(8, '0').replace(/0+$/, '');
    return `${intPart}.${frac}`;
}
