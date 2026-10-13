// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getFormatLocale } from '../../i18n/index.js';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_CUTOFF_MS = 7 * DAY_MS;
const MILLISECOND_TIMESTAMP_FLOOR = 1e11;

function timestampMs(timestamp) {
    const numeric = Number(timestamp);
    if (Number.isFinite(numeric)) {
        if (numeric <= 0) return null;
        const candidate = numeric < MILLISECOND_TIMESTAMP_FLOOR
            ? numeric * SECOND_MS
            : numeric;
        return Number.isNaN(new Date(candidate).getTime()) ? null : candidate;
    }
    if (typeof timestamp !== 'string' || !timestamp.trim()) return null;
    const parsed = Date.parse(timestamp);
    return Number.isNaN(new Date(parsed).getTime()) ? null : parsed;
}

/**
 * Compact elapsed-time wording shared by activity surfaces.
 *
 * @param {number} diffMs elapsed milliseconds
 * @returns {string}
 */
export function formatElapsedTime(diffMs) {
    const elapsed = Math.max(0, Number(diffMs) || 0);
    if (elapsed < 5 * SECOND_MS) return 'just now';
    if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)} sec ago`;
    if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
    if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} hr ago`;
    const days = Math.floor(elapsed / DAY_MS);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Relative time for a Unix timestamp in seconds or milliseconds.
 *
 * @param {unknown} timestamp
 * @param {number} [nowMs]
 * @returns {string}
 */
export function formatRelativeTime(timestamp, nowMs = Date.now()) {
    const ms = timestampMs(timestamp);
    if (ms === null) return '';
    return formatElapsedTime(nowMs - ms);
}

/** Format activity relatively for one week, then as a local calendar date. */
export function formatActivityTime(timestamp, nowMs = Date.now()) {
    const ms = timestampMs(timestamp);
    if (ms === null) return '';
    if (nowMs - ms < RELATIVE_CUTOFF_MS) return formatElapsedTime(nowMs - ms);
    const date = new Date(ms);
    try {
        return date.toLocaleDateString(getFormatLocale(), {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * Absolute time in the viewer's local time zone, with the zone visible.
 *
 * @param {unknown} timestamp Unix timestamp in seconds or milliseconds
 * @returns {string | null}
 */
export function formatLocalDateTime(timestamp) {
    const ms = timestampMs(timestamp);
    if (ms === null) return null;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return date.toLocaleString(getFormatLocale(), {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        });
    } catch {
        return date.toUTCString();
    }
}
