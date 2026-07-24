// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// isWithinQuietHours:  DND scheduling. Shared by NotificationService
// and PriceAlertWatcher so both delivery paths honor the same window with
// identical wrap-past-midnight semantics. Pure function of the settings
// record + a clock, so both callers (and tests) can pin `atDate`.

/**
 * @param {import('../schemas/settings.js').Settings | null | undefined} settings
 * @param {Date} [atDate]  defaults to now; callers/tests may pin a specific instant
 * @returns {boolean}      true when notification delivery should be suppressed
 */
export function isWithinQuietHours(settings, atDate = new Date()) {
    const qh = settings && settings.quietHours;
    if (!qh || qh.enabled !== true) return false;
    const start = parseHHMM(qh.start);
    const end = parseHHMM(qh.end);
    if (start === null || end === null) return false;

    const nowMinutes = atDate.getHours() * 60 + atDate.getMinutes();

    if (start === end) return false; // zero-width window never suppresses
    if (start < end) {
        // Same-day window, e.g. 09:00-17:00.
        return nowMinutes >= start && nowMinutes < end;
    }
    // Wraps past midnight, e.g. 22:00-08:00.
    return nowMinutes >= start || nowMinutes < end;
}

/** @returns {number | null} minutes since midnight, or null if malformed */
function parseHHMM(v) {
    if (typeof v !== 'string') return null;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}
