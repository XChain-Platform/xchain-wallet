// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Exact decimal arithmetic for the DEX order forms (§41.3.4).
//
// A limit order's counter-amount is price × size. Computing that with
// JS floats is wrong twice over: `0.1 * 0.3` yields
// `0.30000000000000004` (a plain-notation artifact the SDK's fractional-
// precision cap then rejects, so the order silently fails), and a very
// small or very large product serialises via `String()` to scientific
// notation ("1e-7" / "1e+21"). Scientific notation has no decimal point,
// so it slips past the SDK/indexer precision cap (`amount.split('.')`)
// and is interpreted at face value: the signed ORDER carries an amount
// the user never intended. Both are value-moving defects.
//
// `multiplyAmounts` multiplies two decimal strings exactly with BigInt
// and returns a plain fixed-notation string (never scientific), so the
// amount shown on the review screen is byte-identical to the amount
// serialised into GIVE_AMOUNT / GET_AMOUNT and the precision cap can do
// its job. Non-decimal input (scientific notation, hex, letters, the
// empty string) and zero-valued operands return null, matching the
// form's "no total yet" state.

/**
 * Parse a plain decimal string into integer/fraction digit parts.
 * Rejects scientific notation, signs, hex, and anything non-decimal so
 * a hostile orderbook price (prefilled via a row click) can't smuggle
 * "1e-7" past the multiply.
 *
 * @param {unknown} v
 * @returns {{ int: string, frac: string } | null}
 */
function parseDecimal(v) {
    if (typeof v === 'bigint') return { int: v.toString(), frac: '' };
    const s = String(v ?? '').trim();
    // At least one digit; optional single dot; digits only. No sign, no
    // exponent, no thousands separators.
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    const [int = '', frac = ''] = s.split('.');
    return { int, frac };
}

/**
 * Exact decimal product of two amounts as a plain fixed-notation string.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {string | null}  plain decimal (e.g. "0.03"), or null when
 *   either operand is not a positive plain-decimal number.
 */
export function multiplyAmounts(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;

    const digitsA = `${pa.int}${pa.frac}`.replace(/^0+(?=\d)/, '') || '0';
    const digitsB = `${pb.int}${pb.frac}`.replace(/^0+(?=\d)/, '') || '0';
    const product = BigInt(digitsA) * BigInt(digitsB);
    if (product === 0n) return null; // zero size or price: no order

    const scale = pa.frac.length + pb.frac.length;
    let digits = product.toString();
    if (scale === 0) return digits;
    if (digits.length <= scale) {
        digits = '0'.repeat(scale - digits.length + 1) + digits;
    }
    const cut = digits.length - scale;
    const intPart = digits.slice(0, cut);
    const fracPart = digits.slice(cut).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Exact decimal comparison of two amounts: -1 when `a < b`, 0 when equal,
 * 1 when `a > b`.
 *
 * Added for, where the answer gates whether a buy may be broadcast at
 * all. `Number(a) >= Number(b)` is the wrong instrument for that: at 8dp a
 * balance and a price that differ by one sat compare equal once they round
 * through a float, which is exactly the case a funding check exists to catch.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1 | null}  null when either operand is not a plain decimal.
 */
export function compareAmounts(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;

    const scale = Math.max(pa.frac.length, pb.frac.length);
    const scaled = (p) => BigInt(`${p.int || '0'}${p.frac.padEnd(scale, '0')}`);
    const left = scaled(pa);
    const right = scaled(pb);
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

/**
 * Exact decimal difference `a - b` as a plain fixed-notation string.
 *
 * Added for: deriving how much of a token an action spends from the
 * confirm surface's projected balances, which arrive as decimal strings at the
 * tick's own DECIMALS. §4.5 rule 1 is explicit that native JS numbers WILL
 * produce false verdicts here, and this value gates a balance reservation, so
 * the subtraction has to be exact at any precision.
 *
 * Returns null on non-decimal input, and null when the result would be
 * negative or zero: callers want "how much was debited", so a credit or a
 * no-op is not a smaller number, it is the absence of a debit.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {string | null}
 */
export function subtractAmounts(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;

    // Align both operands on the wider fraction before subtracting, so
    // "1" - "0.00000001" is exact rather than a float artifact.
    const scale = Math.max(pa.frac.length, pb.frac.length);
    const scaled = (p) => BigInt(
        `${p.int || '0'}${p.frac.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '') || '0',
    );
    const diff = scaled(pa) - scaled(pb);
    if (diff <= 0n) return null;

    let digits = diff.toString();
    if (scale === 0) return digits;
    if (digits.length <= scale) {
        digits = '0'.repeat(scale - digits.length + 1) + digits;
    }
    const cut = digits.length - scale;
    const intPart = digits.slice(0, cut);
    const fracPart = digits.slice(cut).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
}
