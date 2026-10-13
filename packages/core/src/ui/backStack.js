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
// minimizes when the stack is empty. Browsers use a sentinel history entry
// when route snapshots do not already own history. Overlay handlers register
// above route handlers, so a modal or sheet always closes first.

import { useEffect, useRef } from 'react';

/** @type {{ run: () => void }[]} */
const handlers = [];
/** True while a sentinel entry of ours is the current history entry. */
let armed = false;
/** True while a `history.back()` WE issued is still in flight. */
let ignoreNextPop = false;
let syncScheduled = false;
let listening = false;
let routeHistoryManaged = false;
let nativeListener = null;

const hasHistory = () => typeof window !== 'undefined' && Boolean(window.history?.pushState);

const capacitorApp = () => globalThis.Capacitor?.Plugins?.App;

function onNativeBack() {
    const top = handlers[handlers.length - 1];
    if (top) {
        top.run();
        return;
    }
    capacitorApp()?.minimizeApp?.();
}

/** Keep one Capacitor listener alive so Back on a root screen can minimize. */
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
    const top = handlers[handlers.length - 1];
    try {
        if (top) top.run();
    } finally {
        // Re-arm if the screen we landed on can go back too.
        scheduleSync();
    }
}

/** Escape dismisses only the top overlay and never acts as route navigation. */
function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    let top = null;
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
        if (handlers[i].kind !== 'route') {
            top = handlers[i];
            break;
        }
    }
    if (!top) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    top.run();
}

/**
 * Register a back action. The most recently registered one is "on top" and
 * is the one a Back press runs.
 *
 * @param {() => void} run
 * @param {'route' | 'overlay'} [kind]
 * @returns {() => void} unregister
 */
export function registerBackHandler(run, kind = 'overlay') {
    ensureNativeListener();
    if (!listening && typeof window !== 'undefined') {
        window.addEventListener('popstate', onPopState);
        window.addEventListener('keydown', onKeyDown, true);
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
 * @param {'route' | 'overlay'} [kind]
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
    if (listening && typeof window !== 'undefined') {
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('keydown', onKeyDown, true);
    }
    listening = false;
    routeHistoryManaged = false;
    const listener = nativeListener;
    nativeListener = null;
    Promise.resolve(listener).then((handle) => handle?.remove?.());
}
