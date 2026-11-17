// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One short duration style shared by the Duration slider's stops and its
// Custom value: whole hours under a day, whole days under a week, whole
// weeks under a month, whole months under a year (a month is 30 days, a
// year is 12 of them), then years to at most one decimal.
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 12 * MONTH;

function years(seconds) {
    const rounded = Math.round((seconds / YEAR) * 10) / 10;
    const value = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return t('components.durationSlider.years', { count: rounded, value });
}

/**
 * Short label for a span of seconds, or null when it is not a positive
 * finite number. A value that rounds up to the next unit moves into it, so
 * 23.6 hours reads "1 day", never "24 hours".
 */
export function shortDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds < HOUR) {
        const minutes = Math.max(1, Math.round(seconds / 60));
        if (minutes < 60) return t('components.durationSlider.minutes', { value: String(minutes) });
    }
    if (seconds < DAY) {
        const hours = Math.max(1, Math.round(seconds / HOUR));
        if (hours < 24) return t('components.durationSlider.hours', { count: hours, value: String(hours) });
    }
    if (seconds < WEEK) {
        const days = Math.max(1, Math.round(seconds / DAY));
        if (days < 7) return t('components.durationSlider.days', { count: days, value: String(days) });
    }
    if (seconds < MONTH) {
        const weeks = Math.max(1, Math.round(seconds / WEEK));
        // A span just under 30 days rounds to 4 weeks; 5 would pass a month.
        if (weeks < 5 && weeks * WEEK < MONTH) {
            return t('components.durationSlider.weeks', { count: weeks, value: String(weeks) });
        }
    }
    if (seconds < YEAR) {
        const months = Math.max(1, Math.round(seconds / MONTH));
        if (months < 12) return t('components.durationSlider.months', { count: months, value: String(months) });
    }
    return years(seconds);
}
