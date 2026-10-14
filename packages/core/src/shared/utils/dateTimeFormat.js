// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getFormatLocale } from '../../i18n/index.js';

const MILLISECOND_TIMESTAMP_FLOOR = 1e11;
const FALLBACK_UNIT_LABELS = {
    year: { one: 'year', other: 'years' },
    month: { one: 'month', other: 'months' },
    day: { one: 'day', other: 'days' },
    hour: { one: 'hour', other: 'hours' },
    minute: { one: 'minute', other: 'minutes' },
    second: { one: 'second', other: 'seconds' },
};

function dateFromTimestamp(timestamp) {
    const numeric = Number(timestamp);
    if (!Number.isFinite(numeric) || numeric === 0) return null;
    const date = new Date(numeric < MILLISECOND_TIMESTAMP_FLOOR ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a Unix timestamp as a readable date and time in the device time zone. */
export function formatLocalDateTime(timestamp, locale) {
    const date = dateFromTimestamp(timestamp);
    if (!date) return '-';
    try {
        return new Intl.DateTimeFormat(getFormatLocale(locale), {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    } catch {
        return date.toLocaleString();
    }
}

/** Format a Unix timestamp relative to now using the active language. */
export function formatRelativeDateTime(timestamp, now = Date.now(), locale) {
    const date = dateFromTimestamp(timestamp);
    if (!date) return '';
    const diffSeconds = Math.trunc((date.getTime() - now) / 1000);
    const isCurrent = Math.abs(diffSeconds) < 5;
    const ranges = [
        ['year', 365 * 86400],
        ['month', 30 * 86400],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];
    const [unit, seconds] = isCurrent
        ? ['second', 1]
        : ranges.find(([, size]) => Math.abs(diffSeconds) >= size);
    const amount = isCurrent
        ? 0
        : diffSeconds < 0
            ? Math.ceil(diffSeconds / seconds)
            : Math.floor(diffSeconds / seconds);
    try {
        const formatLocale = getFormatLocale(locale);
        if (isCurrent && formatLocale.split('-')[0].toLowerCase() === 'en') return 'just now';
        return new Intl.RelativeTimeFormat(formatLocale, {
            numeric: isCurrent ? 'auto' : 'always',
        })
            .format(amount, unit);
    } catch {
        if (isCurrent) return 'just now';
        const absolute = Math.abs(amount);
        const category = new Intl.PluralRules('en').select(absolute);
        const labels = FALLBACK_UNIT_LABELS[unit];
        const label = labels[category] ?? labels.other;
        return amount < 0 ? `${absolute} ${label} ago` : `in ${absolute} ${label}`;
    }
}
