// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getFormatLocale } from '../../i18n/index.js';

function dateFromTimestamp(timestamp) {
    const numeric = Number(timestamp);
    if (!Number.isFinite(numeric) || numeric === 0) return null;
    const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
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
    const diffSeconds = Math.floor((date.getTime() - now) / 1000);
    if (Math.abs(diffSeconds) < 5) return 'just now';
    const ranges = [
        ['year', 365 * 86400],
        ['month', 30 * 86400],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];
    const [unit, seconds] = ranges.find(([, size]) => Math.abs(diffSeconds) >= size);
    const amount = diffSeconds < 0
        ? Math.ceil(diffSeconds / seconds)
        : Math.floor(diffSeconds / seconds);
    try {
        return new Intl.RelativeTimeFormat(getFormatLocale(locale), { numeric: 'always' })
            .format(amount, unit);
    } catch {
        const absolute = Math.abs(amount);
        const label = `${unit}${absolute === 1 ? '' : 's'}`;
        return amount < 0 ? `${absolute} ${label} ago` : `in ${absolute} ${label}`;
    }
}
