// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { getFormatLocale } from '../../i18n/index.js';
import { compareDecimalStrings, formatDecimalAmount } from './amountFormat.js';

/**
 * Whether a FIAT_AMOUNT is a price the CHAIN will accept.
 *
 * The protocol's rule is "at most 2 decimal places", not "exactly 2":
 * `isValidFiatFormat(2, amount)` (xchain-indexer utility.js, mirrored in
 * xchain-sdk) is `isValidAmountFormat` plus a cap on the fractional digits, so
 * it takes `3` and `3.5` as readily as `3.50`.
 *
 * DispenserForm used to inline `/^\d+\.\d{2}$/`, which demanded the point AND
 * both digits and so refused the most natural way to write a price. On a
 * currency with no minor unit at all - JPY and KRW are both in the form's own
 * currency list - it refused every honest one: a seller pricing a fill at 500
 * yen had to type 500.00. Found by the first run of the fiat dispenser e2e
 * lane, which was stopped at the form by "Fiat amount must look like 12.34."
 * for a $3 price the chain would have taken (D-142).
 *
 * It lives here rather than in the route because a route file exports its
 * component and nothing else - a house rule the dispenser-form smoke pins, and
 * the reason this function moved out of DispenserForm.jsx. The parity test
 * holds it against the SDK's own validator rather than against a second copy
 * of the regex.
 *
 * @param {string | number | null | undefined} amount
 * @returns {boolean}
 */
export function isValidFiatAmount(amount) {
    return /^\d+(\.\d{1,2})?$/.test(String(amount ?? ''));
}

function fiatDisplayState(value) {
    const raw = String(value).trim();
    if (!raw) return null;
    const numericValue = Number(raw);
    const zeroComparison = compareDecimalStrings(raw, '0');
    if (zeroComparison === null && !Number.isFinite(numericValue)) return null;
    const compare = (target) => compareDecimalStrings(raw, target)
        ?? (numericValue === Number(target) ? 0 : numericValue < Number(target) ? -1 : 1);
    const direction = zeroComparison ?? (numericValue === 0 ? 0 : numericValue < 0 ? -1 : 1);
    const tinyPositive = direction === 1 && compare('0.01') === -1;
    const tinyNegative = direction === -1 && compare('-0.01') === 1;
    return {
        displayValue: tinyPositive ? '0.01' : tinyNegative ? '-0.01' : direction === 0 ? '0' : raw,
        threshold: tinyPositive ? '< ' : tinyNegative ? '> ' : '',
    };
}

/** Format an exact decimal value in the selected currency and language. */
export function formatFiatAmount(value, currency = 'USD', locale, options = {}) {
    if (value === null || value === undefined) return '';
    const state = fiatDisplayState(value);
    if (!state) return '';
    const code = String(currency || 'USD').toUpperCase();
    const omitCodeSymbol = options?.omitCodeSymbol === true;
    let formatter;
    try {
        formatter = new Intl.NumberFormat(getFormatLocale(locale), {
            style: 'currency',
            currency: code,
            currencyDisplay: 'symbol',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch {
        const formatted = formatDecimalAmount(state.displayValue, locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
        return `${state.threshold}${formatted}${omitCodeSymbol ? '' : ` ${code}`}`;
    }
    let formatted = formatter.format(state.displayValue);
    if (omitCodeSymbol) {
        const parts = formatter.formatToParts(state.displayValue);
        const currencyIsCode = parts.some(
            (part) => part.type === 'currency' && part.value.toUpperCase() === code,
        );
        if (currencyIsCode) {
            formatted = parts
                .filter((part) => part.type !== 'currency')
                .map((part) => part.value)
                .join('')
                .trim();
        }
    }
    return `${state.threshold}${formatted}`;
}

/** Format a fiat value with a currency name for assistive technology. */
export function formatFiatAmountForSpeech(value, currency = 'USD', locale) {
    if (value === null || value === undefined) return '';
    const state = fiatDisplayState(value);
    if (!state) return '';
    const code = String(currency || 'USD').toUpperCase();
    let formatter;
    try {
        formatter = new Intl.NumberFormat(getFormatLocale(locale), {
            style: 'currency',
            currency: code,
            currencyDisplay: 'name',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch {
        const formatted = formatDecimalAmount(state.displayValue, locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
        const threshold = state.threshold === '< '
            ? 'less than '
            : state.threshold === '> ' ? 'more than ' : '';
        return `${threshold}${formatted} ${code}`;
    }
    const threshold = state.threshold === '< '
        ? 'less than '
        : state.threshold === '> ' ? 'more than ' : '';
    return `${threshold}${formatter.format(state.displayValue)}`;
}
