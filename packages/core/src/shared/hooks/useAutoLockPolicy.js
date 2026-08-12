// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useAutoLockPolicy (§26). Owns the whole foreground auto-lock
// decision for a shell: which timeout applies, whether auto-lock is armed
// at all, performing the lock, and reporting the arm state to the
// extension's service-worker backstop.
//
// MOUNT THIS AT THE SHELL LEVEL (each shell's AppInner, above the view
// switch), never inside a route.: the wiring used to live in
// Home.jsx, and every shell renders exactly one route at a time, so
// navigating to Send / Receive / History / Settings unmounted Home and
// useAutoLock's effect cleanup cancelled the pending timer and dropped
// the activity listeners. A wallet parked on a half-composed Send, on
// Receive with an address on screen, or on Settings therefore never
// locked, no matter what timeout the user configured - and those are
// precisely the screens people walk away from. Calling this from
// AppInner keeps one timer alive for the whole unlocked session
// regardless of which view is on screen.

import { useCallback, useEffect, useRef } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useAutoLock } from './useAutoLock.js';
import { useSettings } from './useSettings.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import {
    AUTOLOCK_MINUTES_DEFAULT,
    AUTOLOCK_MINUTES_MAX,
    AUTOLOCK_MINUTES_MIN,
    AUTOLOCK_NEVER,
} from '../../schemas/settings.js';

// Shells with a foreground event loop the hook can watch. Listed rather
// than inferred so a future shell has to opt in deliberately.
export const AUTO_LOCK_SHELLS = /** @type {const} */ (['popup', 'web', 'desktop']);

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

/**
 * @param {object} opts
 * @param {'loading' | 'error' | 'no-wallet' | 'locked' | 'unlocked' | string} opts.sessionState
 *   the shell's own session status. Auto-lock only arms on 'unlocked'.
 * @param {string | null | undefined} [opts.activeWalletId]
 * @param {(() => void) | undefined} [opts.onLocked] shell refresh, run after a
 *   successful lock so the view switches to the Locked screen.
 * @returns {{ armed: boolean, idleMs: number, minutes: number }}
 */
export function useAutoLockPolicy({ sessionState, activeWalletId, onLocked } = {}) {
    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();

    const onLockedRef = useRef(onLocked);
    onLockedRef.current = onLocked;
    // Re-entrancy guard. A ref, not state: nothing renders from it, and
    // this hook sits above the whole shell tree where an extra render is
    // expensive.
    const lockingRef = useRef(false);

    const lock = useCallback(async () => {
        if (lockingRef.current) return;
        lockingRef.current = true;
        try {
            await messaging.lockWallet();
            onLockedRef.current?.();
        } catch {
            // Swallow: useAutoLock re-arms after firing, so a transient
            // lock failure retries on the next idle window rather than
            // leaving the session unlocked with no timer.
        } finally {
            lockingRef.current = false;
        }
    }, [messaging]);

    // NOTE the `.settings` read. useSettings returns the wrapper
    // `{ settings, loading, error, refresh, update }`; reading
    // `autolockMinutes` off the wrapper (as the old Home.jsx wiring did)
    // silently yields undefined, which pinned every wallet to the
    // fallback timeout and made the Settings control inert.
    const minutes = resolveAutoLockMinutes(settings?.autolockMinutes);

    // §25.2 / G058: demo wallets are unlocked with a randomly-generated
    // password that lives only in the session cache. Auto-locking one
    // strands the user behind a password nobody knows, with only the
    // "wipe wallet data" escape, so demo sessions never auto-lock.
    const isDemoActive = isDemoWallet(activeWalletId);

    const armed = sessionState === 'unlocked'
        && AUTO_LOCK_SHELLS.includes(/** @type {any} */ (shell))
        && minutes !== AUTOLOCK_NEVER
        && !isDemoActive;
    // Keep a real interval even when disarmed: useAutoLock takes idleMs as
    // a dep, and a 0 would make the disarmed-to-armed transition look like
    // an instant timeout if the enable flag ever raced ahead of it.
    const idleMs = (minutes || AUTOLOCK_MINUTES_DEFAULT) * 60 * 1000;

    useAutoLock(lock, { enabled: armed, idleMs });

    // §26 background backstop (extension only): the foreground hook above
    // dies with the popup, so hand the service worker the arm decision and
    // the threshold and let it lock after the popup closes. `reportAutoLock`
    // is implemented by the extension shell only; web/desktop keep a
    // long-lived window and are fully covered by the foreground hook now
    // that it outlives navigation.
    //
    // Skipped while the session status is still resolving: reporting a
    // premature `armed: false` there would disarm the backstop for a
    // wallet that turns out to be unlocked a tick later.
    useEffect(() => {
        if (sessionState === 'loading') return;
        if (typeof messaging?.reportAutoLock !== 'function') return;
        Promise.resolve(
            messaging.reportAutoLock({ armed, idleMs }),
        ).catch(() => { /* best-effort */ });
    }, [messaging, sessionState, armed, idleMs]);

    return { armed, idleMs, minutes };
}
