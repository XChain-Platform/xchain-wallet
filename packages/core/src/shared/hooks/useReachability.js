// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useReachability: §49.1 / G153 polling hook.
//
// Polls `messaging.checkReachabilityRequest({ chainIds })` on an
// interval (default 30s) and exposes the latest result, the timestamp
// of the last successful probe, and a `refresh()` helper. Designed to
// be mounted once near the app root so every banner / staleness label
// reads from a single source of truth.
//
// chainIds default to the keys of `settings.fees`, the same
// "active chain" definition `bridge.getActiveChains` uses (§43.2),
// keeping the user's view consistent with what dApps see.
//
// Three separate paths used to make this hook accuse the user's
// internet connection when nothing was wrong with it.
//   1. An empty chain set was probed anyway, and the host maps "no chains"
//      to `overall: 'offline'`. Settings live in the encrypted vault, so
//      the chain set is EMPTY on the first paint of a cold load and again
//      on the shell re-mount after an auto-lock, which is exactly when the
//      false banner was seen. Silence is now the answer to "nothing to
//      probe": no chains is not evidence about the network.
//   2. A probe that resolved late could overwrite a newer probe's verdict,
//      because the in-flight guard was reset by the next effect run instead
//      of being scoped per probe. That is what made the banner STICK until
//      the user pressed Retry rather than clearing on the next poll.
//   3. One failed round-trip was treated as proof of offline. On a cold
//      load the shell's host may still be booting, so the first failure
//      now buys a fast retry and only a second consecutive failure sets
//      'offline'.
//
// Path 3 covered only the case where the ROUND-TRIP ITSELF fails. A probe
// that succeeds and merely reports one service slow was published on the
// spot, so a single timed-out probe painted a full-width "degraded" bar
// over a working wallet. Each service gets its own 3s budget and they all
// fire at once behind CORS preflights, so a distant client times probes out
// while every backend is healthy: measured 2026-09-02, when a first-time
// user was told bitcoin+dogecoin were degraded, then dogecoin+litecoin
// minutes later, while all nine endpoints answered in ~0.3s from here. A
// verdict that moves between chains like that is a timeout, not an outage.
// So a non-normal verdict is now PROVISIONAL until a second probe agrees,
// and nothing is published at all during the wallet's own cold start, when
// TLS, DNS, the shell's host and every preflight are cold at once. Good
// news still publishes immediately: clearing a banner early is always safe.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from './useSettings.js';
import { registry as registryLib, flows as flowsLib } from '../../index.js';

const DEFAULT_INTERVAL_MS = 30_000;
// How long to wait before re-probing after a single failed round-trip,
// before declaring the wallet offline.
const DEFAULT_FAILURE_RETRY_MS = 2000;
// How long to wait before the probe that has to AGREE before a degraded or
// offline verdict reaches the screen. Short, because a real outage should
// still surface in seconds; the point is a second opinion, not a delay.
const DEFAULT_CONFIRM_MS = 1500;
// Separator for the memo key that joins the probed chain ids into one
// string. NUL is deliberate: it is the one character a chain id can never
// contain, so no id can forge a key boundary. Written as the \u0000 escape
// rather than an embedded raw byte, because a literal NUL makes git
// classify this file as binary and every diff to it unreviewable.
const CHAIN_ID_KEY_SEP = '\u0000';
// The wallet does not accuse itself while it is still starting up. This is
// the window the operator objected to: the banner appearing "immediately on
// wallet load" is what makes a healthy wallet look broken to a new user.
const DEFAULT_STARTUP_GRACE_MS = 8000;
const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]   Polling interval; default 30s.
 * @param {number} [opts.failureRetryMs] Delay before the confirming re-probe after one failure.
 * @param {number} [opts.confirmMs]    Delay before the probe that must AGREE before a degraded/offline verdict is published; default 1.5s.
 * @param {number} [opts.startupGraceMs] Window from mount during which no degraded/offline verdict is published at all; default 8s.
 * @param {string[]} [opts.chainIds]   Override the chain set; otherwise read from settings.fees.
 * @returns {{
 *     loading: boolean,
 *     overall: 'normal' | 'degraded' | 'offline' | 'unknown',
 *     perChain: Array<{ chainId: string, mode: string, services: any }>,
 *     lastChecked: number | null,
 *     refresh: () => void,
 *     error: string | null,
 * }}
 */
export function useReachability(opts = {}) {
    const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0
        ? opts.intervalMs
        : DEFAULT_INTERVAL_MS;
    const failureRetryMs = typeof opts.failureRetryMs === 'number' && opts.failureRetryMs >= 0
        ? opts.failureRetryMs
        : DEFAULT_FAILURE_RETRY_MS;
    const confirmMs = typeof opts.confirmMs === 'number' && opts.confirmMs >= 0
        ? opts.confirmMs
        : DEFAULT_CONFIRM_MS;
    const startupGraceMs = typeof opts.startupGraceMs === 'number' && opts.startupGraceMs >= 0
        ? opts.startupGraceMs
        : DEFAULT_STARTUP_GRACE_MS;
    const { messaging } = useMessaging();
    const { settings } = useSettings();

    // Keyed on the joined ids, not on the settings object, so an unrelated
    // settings write (a fee-strategy edit, an unlock re-read that returns
    // the same chains) keeps the same array identity and does not restart
    // the poll or fire a redundant probe.
    const chainIdsKey = useMemo(() => {
        const raw = Array.isArray(opts.chainIds)
            ? opts.chainIds.filter(Boolean)
            : (settings?.fees && typeof settings.fees === 'object'
                ? Object.keys(settings.fees).sort()
                : []);
        // Drop chains that aren't on the user's active network. No
        // point probing testnet endpoints when the user only sees
        // mainnet. The filter helper tolerates an undefined settings
        // record (returns []).
        return flowsLib.filterChainIdsByActiveNetwork(raw, settings, chainRegistry).join(CHAIN_ID_KEY_SEP);
    }, [opts.chainIds, settings?.fees, settings?.activeNetwork, settings]);

    const chainIds = useMemo(
        () => (chainIdsKey ? chainIdsKey.split(CHAIN_ID_KEY_SEP) : []),
        [chainIdsKey],
    );

    const [overall, setOverall] = useState(/** @type {'normal' | 'degraded' | 'offline' | 'unknown'} */ ('unknown'));
    const [perChain, setPerChain] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(false);
    const [lastChecked, setLastChecked] = useState(/** @type {number | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const pollRef = useRef(/** @type {any} */ (null));
    const retryRef = useRef(/** @type {any} */ (null));
    const mountedRef = useRef(true);
    // Monotonic probe id. Only the newest probe may write state, so a
    // slow answer about a stale chain set can never overwrite a fresh one.
    const seqRef = useRef(0);
    const failuresRef = useRef(0);
    const probeRef = useRef(/** @type {null | (() => void)} */ (null));
    // A non-normal verdict seen once but not yet corroborated. Held here
    // instead of on screen until a second probe returns the same answer.
    const provisionalRef = useRef(/** @type {string | null} */ (null));
    const confirmRef = useRef(/** @type {any} */ (null));
    // Cold-start clock. Set once per hook instance, NOT per effect run, so a
    // chain-set change mid-session does not re-open the grace window.
    const mountedAtRef = useRef(Date.now());

    const probe = useCallback(async () => {
        if (typeof messaging?.checkReachabilityRequest !== 'function') {
            // No host endpoint. Leave state at "unknown" so the
            // banner can hide rather than fabricate "offline".
            return;
        }
        if (chainIds.length === 0) {
            // Nothing to probe: the vault is locked, or settings have not
            // been read back yet. The host answers an empty chain set with
            // 'offline', which reads to the user as "your internet is
            // broken". Stay quiet instead; the probe runs for real as soon
            // as the chain set is seeded.
            return;
        }
        const seq = seqRef.current + 1;
        seqRef.current = seq;
        const isCurrent = () => mountedRef.current && seqRef.current === seq;
        setLoading(true);
        setError(null);
        try {
            const result = await messaging.checkReachabilityRequest({ chainIds });
            if (!isCurrent()) return;
            failuresRef.current = 0;
            const rows = Array.isArray(result?.perChain) ? result.perChain : [];
            // A verdict with no per-chain evidence behind it proves nothing
            // about the network, whatever it claims.
            const verdict = rows.length === 0 ? 'unknown' : (result?.overall || 'unknown');
            // The probe ran and answered, so the "last checked" clock is
            // honest even when the verdict itself is still being corroborated.
            setLastChecked(Date.now());

            if (verdict === 'normal' || verdict === 'unknown') {
                // Good news needs no second opinion. Publishing a recovery
                // immediately is always safe, and it means a chain that comes
                // back stops nagging on the very next poll.
                provisionalRef.current = null;
                if (confirmRef.current) {
                    clearTimeout(confirmRef.current);
                    confirmRef.current = null;
                }
                setOverall(verdict);
                setPerChain(rows);
                return;
            }

            // Degraded or offline. Publish only when a previous probe already
            // said the same thing AND the wallet is past its own cold start.
            const sinceMount = Date.now() - mountedAtRef.current;
            const graceLeft = Math.max(0, startupGraceMs - sinceMount);
            if (provisionalRef.current === verdict && graceLeft === 0) {
                provisionalRef.current = null;
                setOverall(verdict);
                setPerChain(rows);
                return;
            }
            // Hold it. The screen keeps whatever was last PUBLISHED (silence
            // on a cold load), and a confirming probe is scheduled: after the
            // grace window when we are still inside it, so the corroboration
            // lands the moment the wallet is allowed to speak.
            provisionalRef.current = verdict;
            if (confirmRef.current === null) {
                confirmRef.current = setTimeout(() => {
                    confirmRef.current = null;
                    if (mountedRef.current) probeRef.current?.();
                }, graceLeft + confirmMs);
            }
        } catch (err) {
            if (!isCurrent()) return;
            failuresRef.current += 1;
            setError(err?.message || 'Reachability probe failed');
            if (failuresRef.current >= 2) {
                // Two failed round-trips in a row: the wallet really cannot
                // talk to anything.
                setOverall('offline');
                setLastChecked(Date.now());
            } else if (retryRef.current === null) {
                // One failure is not proof. On a cold load or a post-unlock
                // re-mount the shell's own host may still be coming up, and
                // that is not the user's connection. Confirm before saying so.
                retryRef.current = setTimeout(() => {
                    retryRef.current = null;
                    if (mountedRef.current) probeRef.current?.();
                }, failureRetryMs);
            }
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [messaging, chainIds, failureRetryMs, confirmMs, startupGraceMs]);

    probeRef.current = probe;

    const refresh = useCallback(() => {
        // An explicit Retry starts the evidence over: a stale failure count
        // must not make the very next answer count as "second failure", and a
        // stale provisional verdict must not let the NEXT answer publish as
        // though it had already been corroborated.
        failuresRef.current = 0;
        provisionalRef.current = null;
        probe();
    }, [probe]);

    useEffect(() => {
        mountedRef.current = true;
        if (chainIds.length === 0) {
            // Drop any verdict derived from the previous chain set rather
            // than leaving a stale "offline" on screen with nothing behind it.
            // The provisional verdict goes with it: it was evidence about a
            // chain set nobody is showing any more.
            setOverall('unknown');
            setPerChain([]);
            setLoading(false);
            provisionalRef.current = null;
        }
        probe();
        const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
        if (intervalMs > 0) {
            // A hidden app shows no banner, so the poll skips its beats until it is seen again.
            pollRef.current = setInterval(() => { if (!hidden()) probe(); }, intervalMs);
        }
        const onVisible = () => { if (!hidden()) probe(); };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
        return () => {
            mountedRef.current = false;
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
            // Retire this probe generation: a response still in flight is
            // about a chain set we are no longer showing.
            seqRef.current += 1;
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
            if (retryRef.current) {
                clearTimeout(retryRef.current);
                retryRef.current = null;
            }
            if (confirmRef.current) {
                clearTimeout(confirmRef.current);
                confirmRef.current = null;
            }
        };
    }, [probe, intervalMs, chainIds]);

    return { loading, overall, perChain, lastChecked, refresh, error };
}
