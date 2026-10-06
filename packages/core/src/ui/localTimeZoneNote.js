// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * The time zone line under a datetime-local field. Browsers give that input
 * no zone of its own and every form reads its value with Date.parse, which
 * takes it as the device's local time, so the field must say which zone that
 * is. Once a value is entered the line also gives the same moment in UTC,
 * since expirations and deadlines are compared on chain as Unix time.
 *
 * The offset is taken at the entered moment, not now, so a date across a
 * daylight saving change shows the offset that will apply then.
 *
 * @param {string} [value]  the input's current 'YYYY-MM-DDTHH:MM' value
 * @param {string} [timeZone]  IANA zone name; defaults to the device's
 * @returns {string}
 */
export function localTimeZoneNote(value, timeZone = deviceTimeZone()) {
    const ms = value ? Date.parse(String(value)) : NaN;
    const at = Number.isFinite(ms) ? new Date(ms) : new Date();
    const offset = formatUtcOffset(-at.getTimezoneOffset());
    const zone = timeZone ? `${timeZone} (${offset})` : offset;
    const base = `Time is in your local time zone, ${zone}.`;
    if (!Number.isFinite(ms)) return base;
    const iso = at.toISOString();
    return `${base} That is ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC.`;
}

function deviceTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
}

// Minutes east of UTC -> 'UTC', 'UTC-6' or 'UTC+5:30'.
export function formatUtcOffset(minutes) {
    if (!minutes) return 'UTC';
    const sign = minutes > 0 ? '+' : '-';
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
