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
