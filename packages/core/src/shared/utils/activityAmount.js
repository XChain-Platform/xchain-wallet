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

function firstPresent(raw, fields) {
    for (const field of fields) {
        const value = raw?.[field];
        if (value != null && String(value).trim() !== '') return value;
    }
    return '';
}

function activityAmountDescriptor(entry) {
    const raw = entry?.raw || {};
    const action = String(entry?.action || '').toUpperCase();

    if (action === 'ORDER' || action === 'SWAP') {
        const amount = firstPresent(raw, ['give_amount', 'GIVE_AMOUNT']);
        if (amount !== '') return { raw: amount, baseUnits: false, qualifier: '' };
        const quantity = firstPresent(raw, ['give_quantity', 'GIVE_QUANTITY']);
        if (quantity !== '') return { raw: quantity, baseUnits: true, qualifier: '' };
        return null;
    }

    if (action === 'DIVIDEND') {
        const total = firstPresent(raw, [
            'total_paid', 'TOTAL_PAID', 'total_amount', 'TOTAL_AMOUNT', 'debit', 'DEBIT',
        ]);
        if (total !== '') return { raw: total, baseUnits: false, qualifier: '' };
        const perUnit = firstPresent(raw, ['amount', 'AMOUNT']);
        if (perUnit !== '') return { raw: perUnit, baseUnits: false, qualifier: 'per unit' };
        const perUnitQuantity = firstPresent(raw, ['quantity_per_unit', 'QUANTITY_PER_UNIT']);
        if (perUnitQuantity !== '') return { raw: perUnitQuantity, baseUnits: true, qualifier: 'per unit' };
        return null;
    }

    const amount = rawActivityAmount(raw);
    if (amount === '') return null;
    return { raw: amount, baseUnits: action !== 'SEND', qualifier: '' };
}

/** The ticker whose amount the row shows. */
export function activityRowTick(entry) {
    const raw = entry?.raw || {};
    const action = String(entry?.action || '').toUpperCase();
    if (action === 'ORDER' || action === 'SWAP') {
        return String(firstPresent(raw, [
            'give_tick', 'GIVE_TICK', 'give_asset', 'GIVE_ASSET', 'give_coin', 'GIVE_COIN',
        ]) || '');
    }
    if (action === 'DIVIDEND') {
        return String(firstPresent(raw, [
            'dividend_tick', 'DIVIDEND_TICK', 'dividend_asset', 'DIVIDEND_ASSET',
        ]) || '');
    }
    return String(firstPresent(raw, ['tick', 'TICK', 'token', 'TOKEN']) || '');
}

/** Extra copy needed to keep a rate from reading as a total payment. */
export function activityRowAmountQualifier(entry) {
    return activityAmountDescriptor(entry)?.qualifier || '';
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
    const descriptor = activityAmountDescriptor(entry);
    if (!descriptor) return '';
    const amount = descriptor.baseUnits
        ? formatBaseUnits(descriptor.raw, divisibility)
        : String(descriptor.raw);
    return amount ? formatHistoryAmount(amount, direction) : '';
}
