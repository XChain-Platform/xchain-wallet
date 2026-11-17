// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Time maths and labels for the Quiet hours editor. The stored value stays a
// 'HH:MM' 24-hour string (the schema and isWithinQuietHours read it that
// way); everything here only converts to and from minutes since midnight and
// draws a label in the user's clock style.

export const MINUTES_PER_DAY = 1440;
/** The range bar and its handles move in 15 minute steps. */
export const STEP_MINUTES = 15;

/** 'HH:MM' to minutes since midnight, or null when it is not a valid time. */
export function parseClock(value) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value : '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes since midnight (wrapped into one day) to the stored 'HH:MM'. */
export function toClock(minutes) {
    const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}`;
}

/** Snap minutes to the nearest 15 minute step, wrapped into one day. */
export function snapMinutes(minutes) {
    const snapped = Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
    return ((snapped % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Whether the user's Language and Region choice runs a 24-hour clock. The
 * wallet has no separate time-format switch, so the clock follows the chosen
 * language (`settings.language`); with none chosen, or one that runs a 12-hour
 * clock, it is 12-hour. An unknown code falls back to 12-hour too.
 *
 * @param {{ language?: string } | null | undefined} settings
 * @returns {boolean}
 */
export function uses24HourClock(settings) {
    const language = settings && typeof settings.language === 'string' ? settings.language : '';
    if (!language) return false;
    try {
        const cycle = new Intl.DateTimeFormat(language, { hour: 'numeric' }).resolvedOptions().hourCycle;
        return cycle === 'h23' || cycle === 'h24';
    } catch {
        return false;
    }
}

/**
 * A time label: '10:00 PM' by default, '22:00' on a 24-hour clock.
 *
 * @param {number} minutes minutes since midnight
 * @param {boolean} [use24]
 */
export function formatClock(minutes, use24 = false) {
    const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const h = Math.floor(wrapped / 60);
    const mm = String(wrapped % 60).padStart(2, '0');
    if (use24) return `${String(h).padStart(2, '0')}:${mm}`;
    const suffix = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${suffix}`;
}

/** An axis label for a whole hour: '6 AM' / '12 PM', or '06' on a 24-hour clock. */
export function formatHourLabel(hour, use24 = false) {
    if (use24) return String(hour % 24).padStart(2, '0');
    const h = hour % 24;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The quiet window as spans over one day, in minutes. A window that crosses
 * midnight is two spans; an equal start and end is empty (the delivery check
 * treats it as no window).
 *
 * @returns {Array<{ from: number, to: number }>}
 */
export function quietSegments(startMin, endMin) {
    if (startMin === endMin) return [];
    if (startMin < endMin) return [{ from: startMin, to: endMin }];
    return [{ from: 0, to: endMin }, { from: startMin, to: MINUTES_PER_DAY }];
}
