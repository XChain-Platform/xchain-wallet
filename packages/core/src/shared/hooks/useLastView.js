// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useLastView (§24 / G055): wraps the per-wallet last-view memory in
// the React lifecycle hooks each shell needs:
//
//   1. On the first render that sees a wallet id, read the persisted
//      view (if any) and hand it to the shell via `onResume(view)`.
//      Subsequent wallet-id changes also fire `onResume`. The user
//      switched wallets, the previous view does not necessarily map.
//   2. On every change to `currentView`, store it when it is safe to resume.
//      An unsafe route clears the memory so a later unlock opens Home.
//
// The shell's setView call site stays exactly as it was. No need to
// thread the helper into every navigation. The hook listens to view
// changes via the prop and persists in an effect.
//
// Cluster U FOLLOWUP 6: multi-wallet last-view threading. The persist
// effect now skips writes whenever the walletId has just changed but
// the current view is still the previous wallet's nav state. Without
// this guard, switching from wallet A (on /history) to wallet B
// would persist B -> 'history' before B's resume effect could fire,
// stomping any saved state for B.

import { useEffect, useRef } from 'react';
import { readLastView, writeLastView } from '../utils/lastViewMemory.js';
import { normalizeRouteParams, RESUMABLE_VIEWS } from '../utils/lastViewMemory.js';
import {
    afterHistorySettles,
    isBareSentinel,
    isInternalPop,
    setRouteHistoryManaged,
    stepHistoryBack,
    takeSentinelForRoute,
} from '../../ui/backStack.js';
import { useToast } from '../components/ToastHost.jsx';

const PARAM_VIEWS = new Set(['token-detail', 'list-detail', 'dispenser-detail', 'market']);
const RESUMABLE_SET = new Set(RESUMABLE_VIEWS);
// These routes can render secret material, so they share the previous safe
// snapshot instead of leaving a restorable entry in browser history.
const SECRET_HISTORY_VIEWS = new Set(['view-private-key', 'migrate-bip39', 'add-wallet']);

/**
 * A session-history entry for a route, stamped with the network it was made on.
 * @param {string} walletId
 * @param {string | null} network
 * @param {{ view: string, params: object | null }} route
 */
function routeSnapshot(walletId, network, route) {
    return network ? { walletId, network, ...route } : { walletId, ...route };
}

/**
 * An entry made before the network was known, or read before it is known,
 * passes: the check only refuses an entry that names another network.
 * @param {unknown} entryNetwork
 * @param {string | null} network
 */
function sameNetwork(entryNetwork, network) {
    return typeof entryNetwork !== 'string' || !entryNetwork || !network || entryNetwork === network;
}

/** @typedef {{ keys: string[], at: number }} Trail */

/** @param {Trail} trail @param {string} key */
function trailStart(trail, key) {
    trail.keys = [key];
    trail.at = 0;
}

/** A pushed entry drops everything Forward of the current one. @param {Trail} trail @param {string} key */
function trailPush(trail, key) {
    trail.keys = [...trail.keys.slice(0, trail.at + 1), key];
    trail.at = trail.keys.length - 1;
}

/** @param {Trail} trail @param {string} key */
function trailReplace(trail, key) {
    if (trail.at < 0) trailStart(trail, key);
    else trail.keys[trail.at] = key;
}

/**
 * Follow a browser Back or Forward to the entry holding `key`. A Back that
 * only took an overlay's sentinel off lands on the entry already current;
 * otherwise one step either way when the neighbour matches. Anything else
 * starts the trail over from the entry shown, since the entries around it
 * are unknown.
 *
 * @param {Trail} trail
 * @param {string | null} key
 */
function trailFollow(trail, key) {
    if (key === null) {
        trail.keys = [];
        trail.at = -1;
    } else if (trail.at >= 0 && trail.keys[trail.at] === key) {
        // Still on the same entry.
    } else if (trail.at > 0 && trail.keys[trail.at - 1] === key) {
        trail.at -= 1;
    } else if (trail.at >= 0 && trail.keys[trail.at + 1] === key) {
        trail.at += 1;
    } else {
        trailStart(trail, key);
    }
}

/** How many entries below the current one the nearest entry for `key` sits, or 0. @param {Trail} trail @param {string} key */
function stepsBackTo(trail, key) {
    for (let i = trail.at - 1; i >= 0; i -= 1) {
        if (trail.keys[i] === key) return trail.at - i;
    }
    return 0;
}

/**
 * @param {object} args
 * @param {string | null | undefined} args.walletId   Active wallet id.
 * @param {string} args.currentView                   The shell's current `unlockedView`.
 * @param {object | null} [args.currentParams]        Validated context for a supported deep view.
 * @param {(view: string, meta?: { source: 'resume' | 'history' }) => void} args.onResume Called once per walletId change with the persisted view, and on a browser Back or Forward with source 'history'.
 * @param {(view: string, params: object | null) => void} [args.onResumeParams] Primes deep-view state before `onResume` selects it.
 * @param {(view: string) => boolean} [args.onHistoryPop] Browser Back to a page that is not resumable: the shell pops to it and returns true when it is the page below.
 * @param {boolean} [args.sessionActive] Whether the unlocked route is active.
 * @param {boolean} [args.skip]   §24.6 / Cluster Y FU 4: when true, the resume effect is
 *                                suppressed; a freshly-detached desktop window opens on its
 *                                pinned target rather than the user's last resumed view.
 *                                The persist effect still runs so navigation inside the
 *                                detached window survives a refresh.
 * @param {string | null} [args.network]  Active network ('mainnet' | 'testnet' | 'regtest').
 *                                Each session-history entry records it, and Back or Forward
 *                                ignores an entry from another network: a network switch
 *                                reloads the page but keeps its history, and an entry from
 *                                the network the user left would open its token detail with
 *                                a zero balance and a receive address for that network.
 * @param {number} [args.navBacks] How many Back steps the shell's navigation history has taken
 *                                (a Back press, a finished form unwinding). A route change that
 *                                raises it is a Back: the browser steps back to the entry this
 *                                hook wrote for that route rather than gaining a new one, so a
 *                                browser Back right after an in-app Back does not reopen the
 *                                page just left.
 */
export function useLastView({
    walletId,
    currentView,
    currentParams = null,
    onResume,
    onResumeParams,
    onHistoryPop,
    sessionActive = true,
    skip = false,
    network = null,
    navBacks,
}) {
    const lastResumedFor = useRef(/** @type {string | null} */ (null));
    const lastPersistedFor = useRef(/** @type {string | null} */ (null));
    const onResumeRef = useRef(onResume);
    const onResumeParamsRef = useRef(onResumeParams);
    const onHistoryPopRef = useRef(onHistoryPop);
    onHistoryPopRef.current = onHistoryPop;
    const networkRef = useRef(network);
    networkRef.current = typeof network === 'string' && network ? network : null;
    const pendingPopKey = useRef(/** @type {string | null} */ (null));
    const historyKey = useRef(/** @type {string | null} */ (null));
    const historyWallet = useRef(/** @type {string | null} */ (null));
    // The route keys of the browser entries this hook wrote, oldest first,
    // and which of them the browser shows. An overlay sentinel is never in it.
    const trail = useRef({ keys: /** @type {string[]} */ ([]), at: -1 });
    const shownBacks = useRef(/** @type {number | null} */ (null));
    onResumeRef.current = onResume;
    onResumeParamsRef.current = onResumeParams;
    const { dismissStaleToasts } = useToast();
    const normalizedParams = normalizeRouteParams(currentView, currentParams);
    const route = { view: currentView, params: normalizedParams };
    const routeKey = JSON.stringify(route);
    const resumableView = RESUMABLE_SET.has(currentView)
        && (!PARAM_VIEWS.has(currentView) || normalizedParams !== null);

    // A toast belongs to the screen it was raised on: leaving that screen
    // dismisses it, so it never floats over the next screen's fields.
    useEffect(() => {
        dismissStaleToasts?.();
    }, [currentView, routeKey, dismissStaleToasts]);

    // Persist current view whenever it changes, but only after the
    // resume effect has run for this walletId. Without that gate, a
    // wallet switch (where `walletId` flips before `currentView`
    // catches up) writes the stale view under the new wallet's key.
    useEffect(() => {
        if (!sessionActive) return;
        if (typeof walletId !== 'string' || !walletId) return;
        if (lastResumedFor.current !== walletId) {
            // Resume effect hasn't fired for this walletId yet. Wait.
            // The resume effect runs in the next pass and bumps
            // `lastResumedFor`; subsequent currentView changes then
            // persist correctly.
            return;
        }
        if (lastPersistedFor.current !== walletId) {
            // First persist for this walletId after a switch. Skip
            // exactly one tick so the resume's setUnlockedView
            // (called via onResume) propagates into currentView before
            // we write anything. The very next render with
            // currentView matching the resumed value persists normally.
            lastPersistedFor.current = walletId;
            return;
        }
        // Unsafe transaction routes leave a one-shot Home note while every
        // other unsafe route simply clears the older resumable destination.
        writeLastView(walletId, currentView, normalizedParams, { markInterrupted: true });
    }, [walletId, currentView, routeKey, sessionActive]);

    // Session history stores the same validated route payload as reload
    // memory. A pop restores params before selecting the view, so Back and
    // Forward cannot remount a deep screen with an empty ref.
    useEffect(() => {
        if (!sessionActive) return undefined;
        if (typeof walletId !== 'string' || !walletId || typeof window === 'undefined') return undefined;
        setRouteHistoryManaged(true);
        const onPop = (event) => {
            // Closing an overlay takes its Back sentinel out of the browser
            // history; that is not the user going Back a page.
            if (isInternalPop(event)) return;
            const snapshot = event.state?.xcRoute;
            const ours = Boolean(snapshot && snapshot.walletId === walletId && typeof snapshot.view === 'string');
            trailFollow(trail.current, ours
                ? JSON.stringify({ view: snapshot.view, params: normalizeRouteParams(snapshot.view, snapshot.params) })
                : null);
            if (!ours) return;
            if (!sameNetwork(snapshot.network, networkRef.current)) return;
            if (!RESUMABLE_SET.has(snapshot.view)) {
                // Any other page opens only as a Back to the page just below
                // in the shell's own history, which still holds its item.
                if (!onHistoryPopRef.current?.(snapshot.view)) return;
                pendingPopKey.current = JSON.stringify({ view: snapshot.view, params: null });
                historyKey.current = pendingPopKey.current;
                return;
            }
            const params = normalizeRouteParams(snapshot.view, snapshot.params);
            if (PARAM_VIEWS.has(snapshot.view) && !params) return;
            const next = { view: snapshot.view, params };
            pendingPopKey.current = JSON.stringify(next);
            historyKey.current = pendingPopKey.current;
            onResumeParamsRef.current?.(next.view, next.params);
            onResumeRef.current(next.view, { source: 'history' });
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [walletId, sessionActive]);

    useEffect(() => {
        const backs = typeof navBacks === 'number' ? navBacks : null;
        const wentBack = backs !== null && shownBacks.current !== null && backs > shownBacks.current;
        shownBacks.current = backs;        if (!sessionActive) return;
        if (typeof walletId !== 'string' || !walletId || typeof window === 'undefined') return;
        if (historyWallet.current !== walletId) {
            historyWallet.current = walletId;
            historyKey.current = null;
            pendingPopKey.current = null;
            trailFollow(trail.current, null);
        }
        // Every write waits while the Back stack is taking a stale sentinel
        // out: until that Back lands, the current entry is the one leaving.
        if (SECRET_HISTORY_VIEWS.has(currentView)) {
            pendingPopKey.current = null;
            afterHistorySettles(() => {
                const currentSnapshot = window.history.state?.xcRoute;
                const currentParams = currentSnapshot
                    ? normalizeRouteParams(currentSnapshot.view, currentSnapshot.params)
                    : null;
                const currentIsSafe = currentSnapshot?.walletId === walletId
                    && sameNetwork(currentSnapshot.network, networkRef.current)
                    && RESUMABLE_SET.has(currentSnapshot.view)
                    && (!PARAM_VIEWS.has(currentSnapshot.view) || currentParams !== null);
                const safeRoute = currentIsSafe
                    ? { view: currentSnapshot.view, params: currentParams }
                    : { view: 'home', params: null };
                const state = {
                    ...(window.history.state || {}),
                    xcRoute: routeSnapshot(walletId, networkRef.current, safeRoute),
                };
                window.history.replaceState(state, '');
                historyKey.current = JSON.stringify(safeRoute);
                trailReplace(trail.current, historyKey.current);
            });
            return;
        }
        if (pendingPopKey.current === routeKey) {
            pendingPopKey.current = null;
            return;
        }
        if (historyKey.current === routeKey) return;
        const previousKey = historyKey.current;
        historyKey.current = routeKey;
        afterHistorySettles(() => writeRoute(previousKey, wentBack));
    }, [walletId, currentView, routeKey, sessionActive, navBacks]);

    /**
     * Record the route on screen in the browser history.
     *
     * @param {string | null} previousKey  the route recorded before it, null for the first
     * @param {boolean} wentBack  the shell reached it by a Back step
     */
    function writeRoute(previousKey, wentBack) {
        const state = {
            ...(window.history.state || {}),
            xcRoute: routeSnapshot(walletId, networkRef.current, route),
        };
        if (previousKey === null) {
            window.history.replaceState(state, '');
            trailStart(trail.current, routeKey);
        } else if (isBareSentinel(window.history.state)) {
            // An overlay's Back sentinel (the command palette, a menu) is on
            // top: the route takes its slot, so the overlay closing cannot
            // pop the route it just opened.
            window.history.replaceState(state, '');
            takeSentinelForRoute();
            trailPush(trail.current, routeKey);
        } else if (wentBack) {
            // An in-app Back: the browser steps back to the entry it already
            // holds for this page, so its own Back next goes further back
            // instead of reopening the page just left. With no such entry the
            // page left gives up its slot rather than staying Back-reachable.
            const steps = stepsBackTo(trail.current, routeKey);
            if (steps > 0 && stepHistoryBack(steps)) {
                trail.current.at -= steps;
            } else {
                window.history.replaceState(state, '');
                trailReplace(trail.current, routeKey);
            }
        } else {
            window.history.pushState(state, '');
            trailPush(trail.current, routeKey);
        }
    }

    // Resume on wallet activation / change. Skips re-running for the
    // same walletId so user navigation after the resume is not
    // overwritten by a stale read. `skip` short-circuits the resume
    // entirely (detached-window case) but still bumps `lastResumedFor`
    // so the persist gate can advance. Otherwise the persist effect
    // would refuse to write any nav state from the detached window.
    useEffect(() => {
        if (!sessionActive || typeof walletId !== 'string' || !walletId) {
            lastResumedFor.current = null;
            lastPersistedFor.current = null;
            return;
        }
        if (lastResumedFor.current === walletId) return;
        lastResumedFor.current = walletId;
        lastPersistedFor.current = null;
        if (skip) return;
        const persisted = readLastView(walletId, true);
        if (persisted && (persisted.view !== currentView || persisted.params)) {
            onResumeParamsRef.current?.(persisted.view, persisted.params);
            onResumeRef.current(persisted.view);
        } else {
            // No state update follows a miss, so the next user navigation is
            // already safe to persist rather than being mistaken for a switch.
            lastPersistedFor.current = walletId;
        }
    // currentView + skip intentionally omitted. We only resume on
    // walletId change. skip is captured at the moment the resume would
    // fire; flipping skip later does not retroactively trigger the
    // resume.
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, [walletId, sessionActive]);
}
