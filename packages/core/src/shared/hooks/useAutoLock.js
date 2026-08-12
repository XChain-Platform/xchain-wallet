// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef } from 'react';

/**
 * Foreground auto-lock timer (§26).
 *
 * Calls `onLock()` after `idleMs` milliseconds of no user activity
 * while the host is foreground. Activity events: mousemove, keydown,
 * scroll, click, touchstart. The timer ticks every `tickMs` (default
 * 30s) so a precise idle measurement isn't needed; one tick past the
 * threshold is acceptable.
 *
 * Scope note: foreground-only. Doesn't auto-lock while a popup is
 * closed or a web tab is backgrounded. Spec §26 envisions a
 * background-mediated lock that honours the timeout across popup
 * close/open; that needs a `lastActivity` stamp persisted for the
 * service worker to read on startup, tracked separately.
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
 */
export function useAutoLock(
    onLock,
    { idleMs = 5 * 60 * 1000, tickMs = 30 * 1000, enabled = true } = {},
) {
    const lastActivity = useRef(Date.now());
    const onLockRef = useRef(onLock);
    onLockRef.current = onLock;

    useEffect(() => {
        if (!enabled) return undefined;
        const bump = () => { lastActivity.current = Date.now(); };
        const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
        for (const ev of events) {
            window.addEventListener(ev, bump, { passive: true });
        }
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            if (Date.now() - lastActivity.current >= idleMs) {
                try { onLockRef.current?.(); } catch (_err) { /* ignore */ }
                // Re-arm instead of stopping. `onLock` is async and can
                // fail (a messaging round-trip), and bailing here left the
                // session unlocked with no timer for the rest of its life.
                // The successful case tears the hook down anyway: the shell
                // flips to `locked` and passes `enabled: false`.
                lastActivity.current = Date.now();
            }
            window.setTimeout(tick, tickMs);
        };
        const handle = window.setTimeout(tick, tickMs);
        return () => {
            cancelled = true;
            clearTimeout(handle);
            for (const ev of events) window.removeEventListener(ev, bump);
        };
    }, [enabled, idleMs, tickMs]);
}
