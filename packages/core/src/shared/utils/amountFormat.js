// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Display + cursor helpers shared by the amount-input block (Send /
// Receive). Kept separate from the React component so the parent route
// can use the same formatter when re-positioning the caret after a
// reformat.

// "12345.678" → "12,345.678". Preserves whatever fractional precision
// the caller passed; the amount input uses this on both render and
// onChange so commas appear live as the user types.
export function formatWithThousands(value) {
    if (value == null || value === '') return '';
    const str = String(value);
    const negative = str.startsWith('-');
    const abs = negative ? str.slice(1) : str;
    const dotIdx = abs.indexOf('.');
    const intPart = dotIdx === -1 ? abs : abs.slice(0, dotIdx);
    const fracPart = dotIdx === -1 ? '' : abs.slice(dotIdx);
    if (!/^\d+$/.test(intPart)) return str;
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}${grouped}${fracPart}`;
}

// (a): strip the zero tail a DECIMAL sum leaves behind
// ('0.175000000000000000' -> '0.175'), leaving a whole number bare
// ('300.000000000000000000' -> '300').
//
// The indexer sums amounts in DECIMAL(65,18), so an aggregate arrives with
// an 18-place tail whatever the TOKEN's own DECIMALS are - a market priced
// in a 0-decimal token showed its pool as "300.000000000000000000".
// xchain-explorer's db.js trims the same shape at its own read boundary and
// says the trim belongs in one place "rather than in each renderer"; this
// is the wallet-side equal for the sums that reach it untrimmed.
//
// Display only, and never touches a significant digit: a value that is not
// a plain decimal (already trimmed, exponential, non-numeric) comes back
// unchanged rather than guessed at.
export function trimAmountTail(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (!/^-?\d+\.\d+$/.test(s)) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}

// Add decimal amount strings without going through a float. Token amounts
// arrive as strings precisely because they can carry 18 places, and a
// `reduce((a, b) => a + Number(b))` over them re-introduces the binary
// rounding the string form exists to avoid.
//
// Used where the wallet has to aggregate raw rows itself rather than read an
// aggregate the indexer computed - the settled-market split, where the
// explorer's own pool sums cover open bets only.
//
// A value that is not a plain decimal is skipped rather than guessed at,
// matching trimAmountTail's rule: on a screen about money, a number we cannot
// parse must not silently become one we invented.
export function sumDecimalStrings(values) {
    const list = Array.isArray(values) ? values : [];
    const parsed = [];
    let scale = 0;
    for (const v of list) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (!/^-?\d+(\.\d+)?$/.test(s)) continue;
        const negative = s.startsWith('-');
        const abs = negative ? s.slice(1) : s;
        const [int, frac = ''] = abs.split('.');
        if (frac.length > scale) scale = frac.length;
        parsed.push({ negative, int, frac });
    }
    if (parsed.length === 0) return '0';
    let total = 0n;
    for (const { negative, int, frac } of parsed) {
        const scaled = BigInt(int + frac.padEnd(scale, '0'));
        total += negative ? -scaled : scaled;
    }
    if (scale === 0) return String(total);
    const negative = total < 0n;
    const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
    const int = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${int}.${frac}`;
}

// Count non-comma characters before `cursorPos`, used to map cursor
// position across a reformat.
export function countNonCommaBefore(value, cursorPos) {
    let count = 0;
    const end = Math.min(cursorPos, value.length);
    for (let i = 0; i < end; i += 1) {
        if (value[i] !== ',') count += 1;
    }
    return count;
}

// Inverse: find the index in `formatted` that leaves `n` non-comma
// chars to its left.
export function indexAfterNonCommaCount(formatted, n) {
    if (n <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < formatted.length; i += 1) {
        if (formatted[i] !== ',') {
            seen += 1;
            if (seen === n) return i + 1;
        }
    }
    return formatted.length;
}
