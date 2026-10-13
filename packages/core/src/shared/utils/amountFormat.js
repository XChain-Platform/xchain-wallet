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

import { getFormatLocale } from '../../i18n/index.js';

function localeNumberSeparators(locale) {
    try {
        const parts = new Intl.NumberFormat(getFormatLocale(locale)).formatToParts(12345.6);
        return {
            decimal: parts.find((part) => part.type === 'decimal')?.value || '.',
            group: parts.find((part) => part.type === 'group')?.value || ',',
        };
    } catch {
        return { decimal: '.', group: ',' };
    }
}

function validGroupedInteger(value, separator) {
    if (!value.includes(separator)) return /^\d+$/.test(value);
    const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`).test(value);
}

/**
 * Convert a localized, non-negative decimal to the dot-decimal wire form.
 * Mixed dot/comma input uses the last punctuation mark as the decimal mark,
 * while a single ambiguous mark follows the active locale.
 */
export function normalizeLocalizedDecimal(value, locale) {
    if (value === null || value === undefined) return null;
    let raw = String(value).trim();
    if (raw === '') return '';
    if (!/^[\d.,\s\u00a0\u202f]+$/.test(raw)) return null;
    const { decimal: localeDecimal, group: localeGroup } = localeNumberSeparators(locale);
    raw = raw.replace(/[\s\u00a0\u202f]+/g, localeGroup);
    if (raw === '') return null;

    const dotCount = (raw.match(/\./g) || []).length;
    const commaCount = (raw.match(/,/g) || []).length;
    let decimal = null;
    let group = null;

    if (dotCount && commaCount) {
        decimal = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
        group = decimal === '.' ? ',' : '.';
    } else {
        const separator = dotCount ? '.' : commaCount ? ',' : null;
        if (!separator) return /^\d+$/.test(raw) ? raw : null;
        const count = separator === '.' ? dotCount : commaCount;
        if (count > 1) {
            return validGroupedInteger(raw, separator) ? raw.split(separator).join('') : null;
        }
        if (separator === localeGroup && separator !== localeDecimal
            && validGroupedInteger(raw, separator)) {
            return raw.split(separator).join('');
        }
        decimal = separator;
    }

    const pieces = raw.split(decimal);
    if (pieces.length !== 2) return null;
    const [integerRaw, fraction] = pieces;
    if (!/^\d*$/.test(fraction)) return null;
    let integer = integerRaw;
    const integerGroup = group || (integerRaw.includes(localeGroup) ? localeGroup : null);
    if (integerGroup) {
        if (!validGroupedInteger(integerRaw, integerGroup)) return null;
        integer = integerRaw.split(integerGroup).join('');
    } else if (!/^\d*$/.test(integer)) {
        return null;
    }
    if (integer === '' && fraction === '') return '.';
    return `${integer}.${fraction}`;
}

// Group a canonical dot-decimal value with the active locale's separators.
// Fractional precision and an in-progress trailing decimal mark stay intact.
export function formatWithThousands(value, locale) {
    if (value == null || value === '') return '';
    const str = String(value);
    const negative = str.startsWith('-');
    const abs = negative ? str.slice(1) : str;
    const dotIdx = abs.indexOf('.');
    const intPart = dotIdx === -1 ? abs : abs.slice(0, dotIdx);
    const fracPart = dotIdx === -1 ? '' : abs.slice(dotIdx);
    if (!/^\d+$/.test(intPart) && !(intPart === '' && dotIdx === 0)) return str;
    const { decimal, group } = localeNumberSeparators(locale);
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    const localizedFraction = fracPart ? `${decimal}${fracPart.slice(1)}` : '';
    return `${negative ? '-' : ''}${grouped}${localizedFraction}`;
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

/** Group a plain decimal string for display without converting it to a float. */
export function formatDecimalAmount(value, locale, options = {}) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return raw;
    const fractionDigits = match[3]?.length || 0;
    const minimumFractionDigits = options.minimumFractionDigits ?? fractionDigits;
    const maximumFractionDigits = options.maximumFractionDigits ?? fractionDigits;
    try {
        return new Intl.NumberFormat(getFormatLocale(locale), {
            useGrouping: true,
            minimumFractionDigits,
            maximumFractionDigits,
        }).format(raw);
    } catch {
        const sign = match[1];
        const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${sign}${grouped}${match[3] === undefined ? '' : `.${match[3]}`}`;
    }
}

const MIN_DISPLAY_AMOUNT = '0.00000001';

/**
 * Format a user-facing amount with one policy across summary surfaces.
 * Significant digits stay exact, insignificant trailing zeros are removed,
 * and non-zero magnitudes below one base unit remain visible as a threshold.
 */
export function formatDisplayAmount(value, locale) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return raw;

    const sign = match[1];
    const fraction = (match[3] || '').replace(/0+$/, '');
    const unsigned = `${match[2]}${fraction ? `.${fraction}` : ''}`;
    const nonZero = /[1-9]/.test(`${match[2]}${fraction}`);
    if (nonZero && compareDecimalStrings(unsigned, MIN_DISPLAY_AMOUNT) === -1) {
        if (sign === '-') return `> -${formatDecimalAmount(MIN_DISPLAY_AMOUNT, locale)}`;
        return `< ${sign}${formatDecimalAmount(MIN_DISPLAY_AMOUNT, locale)}`;
    }

    const formatted = formatDecimalAmount(unsigned, locale);
    return nonZero ? `${sign}${formatted}` : formatted;
}

/** Add a History direction sign without changing the stored amount. */
export function formatHistoryAmount(value, direction, locale) {
    const raw = String(value ?? '').trim();
    const formatted = formatDisplayAmount(raw, locale);
    if (!formatted || /^[+-]/.test(raw) || !/[1-9]/.test(raw)) return formatted;
    if (direction === 'in') return `+${formatted}`;
    if (direction === 'out') return `-${formatted}`;
    return formatted;
}

/** Render an atomic integer at its divisibility using exact string arithmetic. */
export function formatAtomicAmount(quantity, divisibility = 0, locale) {
    const raw = String(quantity ?? '0').trim();
    const scale = Number(divisibility);
    if (!/^-?\d+$/.test(raw) || !Number.isInteger(scale) || scale < 0) return raw;
    const negative = raw.startsWith('-');
    const digits = negative ? raw.slice(1) : raw;
    if (scale === 0) return formatDecimalAmount(raw, locale);
    const padded = digits.padStart(scale + 1, '0');
    const decimal = `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
    return formatDecimalAmount(decimal, locale);
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

// Parse money values as scaled integers so arithmetic never crosses the
// binary floating-point boundary.
function parseDecimal(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return null;
    const frac = match[3] || '';
    const magnitude = BigInt(`${match[2]}${frac}`);
    return {
        units: match[1] === '-' ? -magnitude : magnitude,
        scale: frac.length,
    };
}

function renderDecimal(units, scale, trim = true) {
    const negative = units < 0n;
    const abs = (negative ? -units : units).toString().padStart(scale + 1, '0');
    if (scale === 0) return `${negative ? '-' : ''}${abs}`;
    const whole = abs.slice(0, -scale);
    const rawFraction = abs.slice(-scale);
    const fraction = trim ? rawFraction.replace(/0+$/, '') : rawFraction;
    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function rescaleDecimal(parsed, scale) {
    return parsed.units * (10n ** BigInt(scale - parsed.scale));
}

/** Compare two plain decimal values exactly. */
export function compareDecimalStrings(a, b) {
    const left = parseDecimal(a);
    const right = parseDecimal(b);
    if (!left || !right) return null;
    const scale = Math.max(left.scale, right.scale);
    const leftUnits = rescaleDecimal(left, scale);
    const rightUnits = rescaleDecimal(right, scale);
    if (leftUnits === rightUnits) return 0;
    return leftUnits < rightUnits ? -1 : 1;
}

/** Multiply two plain decimal values exactly. */
export function multiplyDecimalStrings(a, b) {
    const left = parseDecimal(a);
    const right = parseDecimal(b);
    if (!left || !right) return null;
    return renderDecimal(left.units * right.units, left.scale + right.scale);
}

/** Subtract two plain decimal values exactly. */
export function subtractDecimalStrings(a, b) {
    const left = parseDecimal(a);
    const right = parseDecimal(b);
    if (!left || !right) return null;
    const scale = Math.max(left.scale, right.scale);
    return renderDecimal(
        rescaleDecimal(left, scale) - rescaleDecimal(right, scale),
        scale,
    );
}

/** Divide two decimal values and round half up to the requested precision. */
export function divideDecimalStrings(a, b, precision = 8) {
    const numerator = parseDecimal(a);
    const denominator = parseDecimal(b);
    if (!numerator || !denominator || denominator.units === 0n) return null;
    if (!Number.isInteger(precision) || precision < 0 || precision > 100) return null;
    const negative = (numerator.units < 0n) !== (denominator.units < 0n);
    const left = (numerator.units < 0n ? -numerator.units : numerator.units)
        * (10n ** BigInt(denominator.scale + precision));
    const right = (denominator.units < 0n ? -denominator.units : denominator.units)
        * (10n ** BigInt(numerator.scale));
    let quotient = left / right;
    const remainder = left % right;
    if (remainder * 2n >= right) quotient += 1n;
    return renderDecimal(negative ? -quotient : quotient, precision);
}

/** Return floor(a / b) for non-negative decimal amounts. */
export function decimalQuotientFloor(a, b) {
    const numerator = parseDecimal(a);
    const denominator = parseDecimal(b);
    if (!numerator || !denominator || numerator.units < 0n || denominator.units <= 0n) return null;
    const left = numerator.units * (10n ** BigInt(denominator.scale));
    const right = denominator.units * (10n ** BigInt(numerator.scale));
    return String(left / right);
}

/** Convert a non-negative decimal amount to exact base units. */
export function decimalToBaseUnits(value, decimals = 8) {
    const parsed = parseDecimal(value);
    if (!parsed || parsed.units < 0n || parsed.scale > decimals) return null;
    return parsed.units * (10n ** BigInt(decimals - parsed.scale));
}

/** Convert an integer quantity and divisibility into a decimal amount. */
export function decimalFromBaseUnits(value, decimals = 8) {
    const scale = Number(decimals);
    if (!Number.isInteger(scale) || scale < 0) return null;
    try {
        return renderDecimal(BigInt(String(value)), scale);
    } catch {
        return null;
    }
}

/**
 * Explain when a token amount carries more decimal places than the token supports.
 * Syntax and positivity stay with the calling form so this helper can be added
 * without changing the action parameters that form signs.
 */
export function tokenAmountPrecisionError(value, {
    divisibility = null,
    tick = '',
    noun = 'Amount',
} = {}) {
    if (divisibility === null || divisibility === undefined) return null;
    const places = Number(divisibility);
    if (!Number.isInteger(places) || places < 0) return null;
    const raw = String(value ?? '').trim();
    const match = /^(?:\d+)(?:\.(\d*))?$|^\.(\d+)$/.exec(raw);
    if (!match) return null;
    const suppliedPlaces = (match[1] ?? match[2] ?? '').length;
    if (places === 0 && raw.includes('.')) {
        const tickText = String(tick || '').trim();
        const unit = tickText ? tickText.toUpperCase() : 'this token';
        return `${noun} must be a whole number because ${unit} is indivisible.`;
    }
    if (suppliedPlaces <= places) return null;

    const tickText = String(tick || '').trim();
    const unit = tickText ? tickText.toUpperCase() : 'this token';
    return `${noun} can have at most ${places} decimal place${places === 1 ? '' : 's'} for ${unit}.`;
}

/** Round a decimal half up while retaining the requested trailing places. */
export function roundDecimalString(value, precision = 2) {
    const parsed = parseDecimal(value);
    if (!parsed || !Number.isInteger(precision) || precision < 0) return null;
    if (parsed.scale <= precision) {
        const units = parsed.units * (10n ** BigInt(precision - parsed.scale));
        return renderDecimal(units, precision, false);
    }
    const negative = parsed.units < 0n;
    const magnitude = negative ? -parsed.units : parsed.units;
    const divisor = 10n ** BigInt(parsed.scale - precision);
    let rounded = magnitude / divisor;
    if ((magnitude % divisor) * 2n >= divisor) rounded += 1n;
    return renderDecimal(negative ? -rounded : rounded, precision, false);
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
