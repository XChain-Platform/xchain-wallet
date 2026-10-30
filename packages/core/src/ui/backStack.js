// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The system Back gesture runs the same action as the visible back control.
// Android's narrow App plugin dispatches directly to the top handler and
// uses available history before requiring a confirmed Home exit. Browsers use
// a sentinel history entry when route snapshots do not already own history.
// Overlay handlers take priority over route handlers, so a modal or sheet
// always closes first. A screen handler steps back through a multi-step flow
// (Create and Import wallet): it outranks route handlers like an overlay, but
// backgrounding the app never runs it, because a pause is not a Back press.

import { useEffect, useRef } from 'react';

/** @type {{ run: () => void, kind: 'route' | 'screen' | 'overlay' }[]} */
const handlers = [];
/** True while a sentinel entry of ours is the current history entry. */
let armed = false;
/** True while a `history.back()` WE issued is still in flight. */
let ignoreNextPop = false;
let syncScheduled = false;
let listening = false;
let routeHistoryManaged = false;
let nativeListener = null;
/**
 * The mounted native Back root: its first-press hint, and whether Back skips
 * the history. Only one root screen shows at a time.
 *
 * @type {{ current?: (windowMs: number) => void, skipHistory?: boolean } | null}
 */
let nativeBackRoot = null;
let homeBackAt = null;
/** True from the start of a page unload (a reload or a navigation away) until the grace below passes. */
let unloading = false;
let unloadTimer = null;

const HOME_BACK_WINDOW_MS = 2000;
// A `history.back()` issued while a reload is starting supersedes the reload,
// so the sentinel is left alone for this long after `beforeunload`. A page
// that stays open (the user kept a form in the leave prompt) syncs again
// once the grace has passed.
const UNLOAD_GRACE_MS = 2000;

const hasHistory = () => typeof window !== 'undefined' && Boolean(window.history?.pushState);

const capacitorApp = () => globalThis.Capacitor?.Plugins?.App;

function topHandler() {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
        if (handlers[i].kind !== 'route') return handlers[i];
    }
    return handlers[handlers.length - 1];
}

function onNativeBack(event) {
    const top = topHandler();
    if (top) {
        homeBackAt = null;
        top.run();
        return;
    }
    // Welcome and unlock skip the history: its entries belong to a session
    // that has ended, and popping them changes nothing on screen.
    if (event?.canGoBack && !nativeBackRoot?.skipHistory && typeof window !== 'undefined' && window.history?.back) {
        homeBackAt = null;
        window.history.back();
        return;
    }
    // Only a native Back root (Home, Welcome, unlock) may background the
    // app, and only on a second press within the window.
    if (!nativeBackRoot) return;
    const pressedAt = Date.now();
    const sinceHomeBack = homeBackAt === null ? null : pressedAt - homeBackAt;
    if (sinceHomeBack !== null && sinceHomeBack >= 0 && sinceHomeBack <= HOME_BACK_WINDOW_MS) {
        homeBackAt = null;
        capacitorApp()?.minimizeApp?.();
        return;
    }
    homeBackAt = pressedAt;
    nativeBackRoot.current?.(HOME_BACK_WINDOW_MS);
}

/** iOS edge Back belongs only to in-app navigation and never exits the app. */
function onNativeEdgeBack() {
    topHandler()?.run();
}

/** Keep one Capacitor listener alive so root Back can apply the exit guard. */
function ensureNativeListener() {
    const app = capacitorApp();
    if (nativeListener || typeof app?.addListener !== 'function') return;
    nativeListener = Promise.resolve(app.addListener('backButton', onNativeBack))
        .catch(() => {
            nativeListener = null;
            return null;
        });
}

/** Bring the sentinel in line with whether anything can go back. */
function sync() {
    syncScheduled = false;
    if (!hasHistory()) return;
    if (unloading) return;
    const want = handlers.some((entry) => entry.kind !== 'route')
        || (!routeHistoryManaged && handlers.length > 0);
    if (want && !armed) {
        window.history.pushState({ xcBack: true }, '');
        armed = true;
    } else if (!want && armed) {
        // The user got home by an on-screen control, so the sentinel is
        // stale. Take it back out, and do not mistake the resulting
        // popstate for a Back press.
        armed = false;
        ignoreNextPop = true;
        window.history.back();
    }
}

function onBeforeUnload() {
    unloading = true;
    clearTimeout(unloadTimer);
    unloadTimer = setTimeout(() => {
        unloading = false;
        unloadTimer = null;
        scheduleSync();
    }, UNLOAD_GRACE_MS);
}

/**
 * Deferred, so a screen change that unmounts one header and mounts another
 * in the same commit is seen as "still has a back action" and touches the
 * history not at all.
 */
function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    setTimeout(sync, 0);
}

function onPopState() {
    if (ignoreNextPop) {
        ignoreNextPop = false;
        return;
    }
    if (!armed) return; // not our entry; someone else's navigation
    armed = false;
    const top = topHandler();
    try {
        if (top) top.run();
    } finally {
        // Re-arm if the screen we landed on can go back too.
        scheduleSync();
    }
}

/** Escape dismisses only the top overlay or flow step and never acts as route navigation. */
function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    const top = topHandler();
    if (!top || top.kind === 'route') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    top.run();
}

/**
 * Register a back action. The most recently registered overlay or screen step
 * is "on top"; route handlers run only when neither is present.
 *
 * @param {() => void} run
 * @param {'route' | 'screen' | 'overlay'} [kind]
 * @returns {() => void} unregister
 */
export function registerBackHandler(run, kind = 'overlay') {
    homeBackAt = null;
    ensureNativeListener();
    if (!listening && typeof window !== 'undefined') {
        window.addEventListener('popstate', onPopState);
        window.addEventListener('beforeunload', onBeforeUnload);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('xchain:native-edge-back', onNativeEdgeBack);
        listening = true;
    }
    const entry = { run, kind };
    handlers.push(entry);
    scheduleSync();
    return () => {
        const index = handlers.indexOf(entry);
        if (index !== -1) handlers.splice(index, 1);
        scheduleSync();
    };
}

/** Dismiss every transient overlay while leaving flow steps and route navigation untouched. */
export function dismissAllOverlays() {
    const overlays = handlers.filter((entry) => entry.kind === 'overlay').reverse();
    for (const entry of overlays) entry.run();
}

/**
 * Make the system Back gesture run `onBack` while the calling component is
 * mounted.
 *
 * `onBack` may change identity on every render; the registration does not
 * churn with it. While `disabled`, a Back press is swallowed rather than
 * passed through: the screen has said back is unavailable right now (a
 * submit in flight), and leaving the app instead would be worse than
 * nothing happening.
 *
 * @param {(() => void) | undefined} onBack
 * @param {boolean} [disabled]
 * @param {'route' | 'screen' | 'overlay'} [kind]
 */
export function useBackHandler(onBack, disabled = false, kind = 'overlay') {
    const latest = useRef({ onBack, disabled });
    latest.current = { onBack, disabled };
    const present = typeof onBack === 'function';
    useEffect(() => {
        ensureNativeListener();
        if (!present) return undefined;
        return registerBackHandler(() => {
            const { onBack: run, disabled: off } = latest.current;
            if (!off && typeof run === 'function') run();
        }, kind);
    }, [present, kind]);
}

/**
 * Marks the mounted screen as a native Back root (Home, Welcome, unlock)
 * that may background the app on a second press. `onExitArmed` runs on the
 * first press, with the window in milliseconds, so the screen can say a
 * second one leaves. With `skipHistory`, Back ignores the WebView history.
 *
 * @param {boolean} [enabled]
 * @param {(windowMs: number) => void} [onExitArmed]
 * @param {boolean} [skipHistory]
 */
export function useNativeBackRoot(enabled = true, onExitArmed, skipHistory) {
    const root = useRef(onExitArmed);
    root.current = onExitArmed;
    root.skipHistory = skipHistory;
    useEffect(() => {
        ensureNativeListener();
        if (!enabled) return undefined;
        nativeBackRoot = root;
        // The next root can mount before this one's cleanup runs (locking
        // swaps Home for unlock), so only the current root clears the slot.
        return () => {
            if (nativeBackRoot === root) nativeBackRoot = null;
        };
    }, [enabled]);
}

/** Let the shell's route snapshots own browser Back while keeping overlay
 * handlers on the sentinel stack. */
export function setRouteHistoryManaged(managed) {
    routeHistoryManaged = Boolean(managed);
    if (routeHistoryManaged && armed && !handlers.some((entry) => entry.kind !== 'route')) {
        armed = false;
    }
    scheduleSync();
}

/** Test seam: forget everything, as a fresh page load would. */
export function resetBackStackForTests() {
    handlers.length = 0;
    armed = false;
    ignoreNextPop = false;
    syncScheduled = false;
    unloading = false;
    clearTimeout(unloadTimer);
    unloadTimer = null;
    if (listening && typeof window !== 'undefined') {
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('xchain:native-edge-back', onNativeEdgeBack);
    }
    listening = false;
    routeHistoryManaged = false;
    nativeBackRoot = null;
    homeBackAt = null;
    const listener = nativeListener;
    nativeListener = null;
    Promise.resolve(listener).then((handle) => handle?.remove?.());
}
