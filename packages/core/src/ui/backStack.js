// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The system Back gesture, wired to whatever back action is on screen.
//
// The wallet navigates by view state, not by URL, so the browser's session
// history never grew: there was nothing for a Back press to go back TO. On
// Android that meant the Back key left the app from every inner screen
// (measured on an LG K51, 2026-10-12: Receive -> Back -> launcher), and on
// the web it meant the browser's Back button left the wallet.
//
// The fix keeps exactly one invariant: THERE IS ONE SENTINEL HISTORY ENTRY ON
// TOP IF AND ONLY IF SOME SCREEN HAS A BACK ACTION. A Back press pops the
// sentinel, which fires `popstate`, which runs the top screen's own back
// action - the same function its on-screen chevron calls, so the two can
// never disagree about where "back" goes. With no back action registered
// there is no sentinel, so a Back press does what the platform would have
// done anyway: leave.
//
// The shell needs no knowledge of any of this. Android only has to ask the
// WebView whether it can go back (`MainActivity.routeBackKeyToTheWebView`).

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

const hasHistory = () => typeof window !== 'undefined' && Boolean(window.history?.pushState);

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

/**
 * Register a back action. The most recently registered one is "on top" and
 * is the one a Back press runs.
 *
 * @param {() => void} run
 * @param {'route' | 'overlay'} [kind]
 * @returns {() => void} unregister
 */
export function registerBackHandler(run, kind = 'overlay') {
    if (!listening && typeof window !== 'undefined') {
        window.addEventListener('popstate', onPopState);
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
    if (listening && typeof window !== 'undefined') window.removeEventListener('popstate', onPopState);
    listening = false;
    routeHistoryManaged = false;
}
