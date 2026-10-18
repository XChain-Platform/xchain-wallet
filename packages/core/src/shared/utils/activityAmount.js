// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The amount an activity row prints, shared by Home's Activity tab and the
// History screen so one action reads the same figure on both.

import { formatHistoryAmount } from './amountFormat.js';

/**
 * Format a base-unit amount string using the tick's divisibility. Plain
 * string math, no BigInt; an unparseable value is returned as given.
 *
 * @param {unknown} raw
 * @param {number} [divisibility]
 * @returns {string}
 */
export function formatBaseUnits(raw, divisibility) {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const div = Number.isFinite(divisibility) ? divisibility : 8;
    if (div === 0) return s;
    if (!/^\d+$/.test(s)) return s;
    const padded = s.padStart(div + 1, '0');
    const whole = padded.slice(0, -div);
    const frac = padded.slice(-div).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

/**
 * The raw amount field of an activity record, or ''.
 *
 * @param {any} raw
 * @returns {string}
 */
export function rawActivityAmount(raw) {
    return raw?.amount ?? raw?.AMOUNT ?? raw?.quantity ?? raw?.QUANTITY ?? '';
}

/**
 * The formatted amount of an activity row, without the ticker, or '' when
 * the record carries none. A SEND record carries a whole-unit decimal amount
 * and is shown as-is (reading it as base units showed a 100 BTC receive as
 * 0.000001 BTC); every other action carries base units.
 *
 * @param {{ action?: string, raw?: any }} entry
 * @param {{ divisibility?: number, direction?: 'in' | 'out' | null }} [opts]
 * @returns {string}
 */
export function activityRowAmount(entry, { divisibility, direction = null } = {}) {
    const rawAmount = rawActivityAmount(entry?.raw);
    if (!rawAmount) return '';
    const isSend = String(entry?.action || '').toUpperCase() === 'SEND';
    const amount = isSend ? String(rawAmount) : formatBaseUnits(rawAmount, divisibility);
    return amount ? formatHistoryAmount(amount, direction) : '';
}
