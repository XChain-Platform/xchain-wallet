// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Text helpers for the one-line summaries of closed form sections.

/**
 * An address shortened for a section summary, "bc1q...7c1c" (first four and
 * last four), as the standard's drawings write it. Short values pass through.
 *
 * @param {string | null | undefined} address
 * @returns {string}
 */
export function summaryAddress(address) {
    const text = typeof address === 'string' ? address.trim() : '';
    if (text.length <= 12) return text;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

/**
 * Joins the non-empty parts of a summary with ", ".
 *
 * @param {...(string | null | undefined | false)} parts
 * @returns {string}
 */
export function joinSummary(...parts) {
    return parts.filter((part) => typeof part === 'string' && part.trim() !== '').join(', ');
}
