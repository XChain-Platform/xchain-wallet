// useReachability — §49.1 / G153 polling hook.
//
// Polls `messaging.checkReachabilityRequest({ chainIds })` on an
// interval (default 30s) and exposes the latest result, the timestamp
// of the last successful probe, and a `refresh()` helper. Designed to
// be mounted once near the app root so every banner / staleness label
// reads from a single source of truth.
//
// chainIds default to the keys of `settings.fees` — that's the same
// "active chain" definition `bridge.getActiveChains` uses (§43.2),
// keeping the user's view consistent with what dApps see.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from './useSettings.js';
import { registry as registryLib, flows as flowsLib } from '../../index.js';

const DEFAULT_INTERVAL_MS = 30_000;
const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]   Polling interval; default 30s.
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
    const { messaging } = useMessaging();
    const { settings } = useSettings();

    const chainIds = useMemo(() => {
        const raw = Array.isArray(opts.chainIds)
            ? opts.chainIds.filter(Boolean)
            : (settings?.fees && typeof settings.fees === 'object'
                ? Object.keys(settings.fees).sort()
                : []);
        // Drop chains that aren't on the user's active network — no
        // point probing testnet endpoints when the user only sees
        // mainnet. The filter helper tolerates an undefined settings
        // record (returns []).
        return flowsLib.filterChainIdsByActiveNetwork(raw, settings, chainRegistry);
    }, [opts.chainIds, settings?.fees, settings?.activeNetwork, settings]);

    const [overall, setOverall] = useState(/** @type {'normal' | 'degraded' | 'offline' | 'unknown'} */ ('unknown'));
    const [perChain, setPerChain] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(false);
    const [lastChecked, setLastChecked] = useState(/** @type {number | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const pollRef = useRef(/** @type {any} */ (null));
    const cancelledRef = useRef(false);

    const probe = useCallback(async () => {
        if (typeof messaging?.checkReachabilityRequest !== 'function') {
            // No host endpoint — leave state at "unknown" so the
            // banner can hide rather than fabricate "offline".
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await messaging.checkReachabilityRequest({ chainIds });
            if (cancelledRef.current) return;
            setOverall(result?.overall || 'unknown');
            setPerChain(Array.isArray(result?.perChain) ? result.perChain : []);
            setLastChecked(Date.now());
        } catch (err) {
            if (cancelledRef.current) return;
            // A failed probe is itself a strong "offline" signal — but
            // only for the duration of this poll. The next probe gets a
            // fresh shot.
            setOverall('offline');
            setError(err?.message || 'Reachability probe failed');
            setLastChecked(Date.now());
        } finally {
            if (!cancelledRef.current) setLoading(false);
        }
    }, [messaging, chainIds]);

    const refresh = useCallback(() => { probe(); }, [probe]);

    useEffect(() => {
        cancelledRef.current = false;
        probe();
        if (intervalMs > 0) {
            pollRef.current = setInterval(() => { probe(); }, intervalMs);
        }
        return () => {
            cancelledRef.current = true;
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [probe, intervalMs]);

    return { loading, overall, perChain, lastChecked, refresh, error };
}
