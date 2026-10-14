// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef } from 'react';
import {
    AUTO_LOCK_GUARD_CHANGED_EVENT,
    isAutoLockHeld,
} from './autoLockGuard.js';

const CLOCK_DRIFT_TOLERANCE_MS = 5 * 60 * 1000;

function monotonicNow() {
    return typeof globalThis.performance?.now === 'function'
        ? globalThis.performance.now()
        : Date.now();
}

/**
 * Measure an in-process idle interval without trusting a large wall-clock jump.
 * Small differences preserve elapsed time across ordinary timer throttling,
 * while a clock correction falls back to the monotonic clock.
 */
export function clockSafeElapsed(
    wallStartedAt,
    monotonicStartedAt,
    wallNow = Date.now(),
    monotonicCurrent = monotonicNow(),
) {
    const wallElapsed = Math.max(0, wallNow - wallStartedAt);
    const monotonicElapsed = Math.max(0, monotonicCurrent - monotonicStartedAt);
    if (Math.abs(wallElapsed - monotonicElapsed) > CLOCK_DRIFT_TOLERANCE_MS) {
        return monotonicElapsed;
    }
    return Math.max(wallElapsed, monotonicElapsed);
}

/**
 * Foreground auto-lock timer (§26).
 *
 * Calls `onLock()` after `idleMs` milliseconds of no user activity
 * while the host is foreground. Activity events: mousemove, keydown,
 * scroll, click, touchstart. The timer ticks every `tickMs` (default
 * 30s) so a precise idle measurement isn't needed; one tick past the
 * threshold is acceptable.
 *
 * Scope note: this is the FOREGROUND half of the §26 auto-lock; its
 * timer only runs while the caller is mounted in a live renderer. The
 * out-of-renderer half already exists: `useAutoLockPolicy` reports
 * `{ armed, idleMs }` through `messaging.reportAutoLock`, the extension
 * service worker checks that record on its keepalive alarm (popup
 * closed), and desktop main checks its `autolock.json` copy at launch
 * (quit and relaunch). Plain web implements no backstop; see
 * `useAutoLockPolicy` for why. Don't add a second backstop here.
 *
 * Pass `enabled: false` to make the hook a no-op; the React hook
 * rules forbid skipping the call itself, so callers pass a flag when
 * they want auto-lock off (e.g. while a lock action is already
 * in-flight). All three shells (popup, web, desktop) opt in through
 * `useAutoLockPolicy`, which owns the enable decision and the timeout.
 *
 * - MOUNT POINT IS LOAD-BEARING: the effect cleanup cancels the
 * pending timer, so this hook only counts idle time while its caller is
 * mounted. Call it (via useAutoLockPolicy) from a shell-level component
 * that outlives navigation, never from a route: wiring it into Home
 * meant a wallet left on Send / Receive / History / Settings never
 * locked at all.
 *
 * @param {() => void} onLock
 * @param {object} [opts]
 * @param {number} [opts.idleMs]   default 5 minutes
 * @param {number} [opts.tickMs]   default 30 seconds
 * @param {boolean} [opts.enabled] default true
 * @param {() => void} [opts.onDeferred] called when an elapsed deadline waits for a guarded operation
 * @returns {() => boolean} checks the deadline immediately and reports whether locking started
 */
export function useAutoLock(
    onLock,
    {
        idleMs = 5 * 60 * 1000,
        tickMs = 30 * 1000,
        enabled = true,
        onDeferred,
    } = {},
) {
    const lastActivity = useRef({ wall: Date.now(), monotonic: monotonicNow() });
    const onLockRef = useRef(onLock);
    const onDeferredRef = useRef(onDeferred);
    const checkNowRef = useRef(() => false);
    onLockRef.current = onLock;
    onDeferredRef.current = onDeferred;

    useEffect(() => {
        if (enabled) lastActivity.current = { wall: Date.now(), monotonic: monotonicNow() };
    }, [enabled]);

    useEffect(() => {
        if (!enabled) {
            checkNowRef.current = () => false;
            return undefined;
        }
        let deferred = false;
        const bump = () => {
            lastActivity.current = { wall: Date.now(), monotonic: monotonicNow() };
            deferred = false;
        };
        const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
        for (const ev of events) {
            window.addEventListener(ev, bump, { passive: true });
        }
        let cancelled = false;
        let handle;
        function schedule() {
            const elapsed = clockSafeElapsed(
                lastActivity.current.wall,
                lastActivity.current.monotonic,
            );
            const remaining = Math.max(0, idleMs - elapsed);
            handle = window.setTimeout(tick, Math.min(tickMs, remaining));
        }
        function tick() {
            if (cancelled) return false;
            const elapsed = clockSafeElapsed(
                lastActivity.current.wall,
                lastActivity.current.monotonic,
            );
            if (elapsed >= idleMs) {
                if (isAutoLockHeld()) {
                    if (!deferred) onDeferredRef.current?.();
                    deferred = true;
                    schedule();
                    return false;
                }
                try { onLockRef.current?.(); } catch (_err) { /* ignore */ }
                // Re-arm instead of stopping. `onLock` is async and can
                // fail (a messaging round-trip), and bailing here left the
                // session unlocked with no timer for the rest of its life.
                // The successful case tears the hook down anyway: the shell
                // flips to `locked` and passes `enabled: false`.
                lastActivity.current = { wall: Date.now(), monotonic: monotonicNow() };
                deferred = false;
                schedule();
                return true;
            }
            schedule();
            return false;
        }
        const checkNow = () => {
            clearTimeout(handle);
            return tick();
        };
        checkNowRef.current = checkNow;
        const onVisibilityChange = () => {
            const cap = /** @type {any} */ (globalThis).Capacitor;
            const nativeAppOwnsResume = Boolean(
                cap?.Plugins?.App?.addListener
                && (typeof cap.isNativePlatform !== 'function' || cap.isNativePlatform()),
            );
            if (document.visibilityState === 'visible' && !nativeAppOwnsResume) checkNow();
        };
        const onGuardChange = () => {
            if (!isAutoLockHeld()) checkNow();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener(AUTO_LOCK_GUARD_CHANGED_EVENT, onGuardChange);
        schedule();
        return () => {
            cancelled = true;
            checkNowRef.current = () => false;
            clearTimeout(handle);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener(AUTO_LOCK_GUARD_CHANGED_EVENT, onGuardChange);
            for (const ev of events) window.removeEventListener(ev, bump);
        };
    }, [enabled, idleMs, tickMs]);

    return useCallback(() => checkNowRef.current(), []);
}
