// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const FRACTION_DIGITS = 2;

/**
 * Formats a signed percentage and classifies the direction users see.
 * Values that round to zero stay neutral so text, labels, and color agree.
 *
 * @param {number} value
 * @returns {{ text: string, direction: 'positive' | 'negative' | 'neutral', label: string } | null}
 */
export function percentChangeDisplay(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;

    const magnitude = Math.abs(value).toFixed(FRACTION_DIGITS);
    const direction = Number(magnitude) === 0
        ? 'neutral'
        : value > 0 ? 'positive' : 'negative';
    const sign = direction === 'positive' ? '+' : direction === 'negative' ? '-' : '';
    const text = `${sign}${magnitude}%`;
    const directionText = direction === 'positive'
        ? 'Increase'
        : direction === 'negative' ? 'Decrease' : 'No change';

    return { text, direction, label: `${directionText}: ${text}` };
}
