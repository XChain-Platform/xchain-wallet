// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings values needed before a route loads. Keep this leaf module free of
// validators and defaults so the lock screen and shell policies do not pull
// the complete persisted-settings schema into the startup bundle.

export const NETWORK_DEFAULT = 'mainnet';

export const CLIPBOARD_AUTO_CLEAR_MAX = 600;
export const CLIPBOARD_AUTO_CLEAR_DEFAULT = 60;

export const AUTOLOCK_NEVER = 0;
export const AUTOLOCK_MINUTES_MIN = 1;
export const AUTOLOCK_MINUTES_MAX = 1440;
export const AUTOLOCK_MINUTES_DEFAULT = 15;

/**
 * Normalise the stored `autolockMinutes` into a usable timeout.
 *
 * Returns `AUTOLOCK_NEVER` (0) only for the user's explicit "Never
 * (until tab close)" choice. A missing, non-numeric or negative value
 * falls back to the schema default instead of to "off": a corrupt or
 * pre-v2 record must still lock. Out-of-range values are clamped, which
 * only matters for hand-edited storage since the Settings UI can't
 * produce them.
 *
 * @param {unknown} raw
 * @returns {number} minutes, or AUTOLOCK_NEVER for "off"
 */
export function resolveAutoLockMinutes(raw) {
    // Deliberately NOT a bare Number(raw): `null` and `''` both coerce to 0,
    // which would read a missing field as the user asking for "Never" and
    // silently disable auto-lock. Only a real number (or a non-blank numeric
    // string) is allowed to mean 0.
    const n = typeof raw === 'number'
        ? raw
        : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
    if (!Number.isFinite(n) || n < 0) return AUTOLOCK_MINUTES_DEFAULT;
    if (n === AUTOLOCK_NEVER) return AUTOLOCK_NEVER;
    // Clamp before rounding so 0 < n < 1 lands on the 1-minute floor
    // instead of rounding down into the "Never" sentinel.
    return Math.round(Math.max(AUTOLOCK_MINUTES_MIN, Math.min(AUTOLOCK_MINUTES_MAX, n)));
}
