// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// QueuedBroadcastBanner — §49.5 / G154.
//
// Surfaces signed transactions that were queued for broadcast — typically
// because the user was offline when they signed. Each row exposes
// "Broadcast now" and "Discard" affordances and clears itself from the
// queue on action. Hidden when the queue is empty, so it costs nothing
// in the normal case.
//
// History: v0.170.0 shipped the UI + messaging surface; v0.292.0 wired
// auto-enqueue from action.* broadcast failures (Cluster G FOLLOWUP 1);
// v0.293.0 moved the queue into chrome.storage.local / localStorage so
// it survives reload (Cluster G FOLLOWUP 2); v0.294.0 adds the §49.5
// reconnection prompt — when reachability flips offline/degraded →
// normal AND the queue is non-empty, surface a one-shot toast with an
// "Open queue" action so the user knows to retry (Cluster G FOLLOWUP 3).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useReachability } from '../hooks/useReachability.js';
import { useToast } from './ToastHost.jsx';
import styles from './QueuedBroadcastBanner.module.css';

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {number} [props.intervalMs]   how often to re-list the queue (defaults to 30s)
 */
export function QueuedBroadcastBanner({ walletId, intervalMs = 30_000 }) {
    const { messaging } = useMessaging();
    const [queue, setQueue] = useState(/** @type {any[]} */ ([]));
    const [busyId, setBusyId] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Cluster G FOLLOWUP 3 — reconnection prompt. Track previous
    // reachability `overall` so a transition `offline|degraded → normal`
    // with a non-empty queue surfaces a one-shot toast nudging the user
    // to broadcast.
    const { overall: reachabilityOverall } = useReachability({});
    const { showToast } = useToast();
    const prevOverallRef = useRef(/** @type {string | null} */ (null));
    const lastPromptedAtRef = useRef(/** @type {number} */ (0));
    const bannerRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const refresh = useCallback(async () => {
        if (!walletId || typeof messaging?.listQueuedBroadcasts !== 'function') return;
        try {
            const list = await messaging.listQueuedBroadcasts({ walletId });
            setQueue(Array.isArray(list) ? list : []);
        } catch (_err) {
            // The list endpoint is read-only; failures here surface
            // through the reachability banner instead.
        }
    }, [messaging, walletId]);

    useEffect(() => {
        refresh();
        if (intervalMs > 0) {
            const id = setInterval(refresh, intervalMs);
            return () => clearInterval(id);
        }
        return undefined;
    }, [refresh, intervalMs]);

    // Reconnection prompt: fire once per offline|degraded → normal
    // transition when there's something to broadcast. Dedupe via a
    // 60s floor on lastPromptedAtRef so a flapping connection doesn't
    // spam the toast.
    useEffect(() => {
        const prev = prevOverallRef.current;
        prevOverallRef.current = reachabilityOverall;
        if (prev !== 'offline' && prev !== 'degraded') return;
        if (reachabilityOverall !== 'normal') return;
        if (queue.length === 0) return;
        const now = Date.now();
        if (now - lastPromptedAtRef.current < 60_000) return;
        lastPromptedAtRef.current = now;
        showToast({
            message: queue.length === 1
                ? 'You have 1 queued transaction. Broadcast now?'
                : `You have ${queue.length} queued transactions. Broadcast now?`,
            actionLabel: 'Open queue',
            onAction: () => {
                // Source of truth is the banner — focus it so screen
                // readers + keyboard users land on the action buttons.
                if (bannerRef.current && typeof bannerRef.current.focus === 'function') {
                    bannerRef.current.focus();
                    bannerRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            },
            durationMs: 12_000,
        });
    }, [reachabilityOverall, queue.length, showToast]);

    if (queue.length === 0) return null;

    async function broadcast(id) {
        if (busyId) return;
        setBusyId(id);
        setError(null);
        try {
            await messaging.broadcastQueuedRequest({ walletId, id });
            await refresh();
        } catch (err) {
            setError(err?.message || 'Broadcast failed.');
        } finally {
            setBusyId(null);
        }
    }
    async function discard(id) {
        if (busyId) return;
        setBusyId(id);
        try {
            await messaging.discardQueuedRequest({ walletId, id });
            await refresh();
        } catch (err) {
            setError(err?.message || 'Discard failed.');
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div
            ref={bannerRef}
            role="status"
            aria-live="polite"
            className={styles.banner}
            tabIndex={-1}
        >
            <div className={styles.title}>
                Queued for broadcast ({queue.length})
            </div>
            <ul className={styles.list}>
                {queue.map((entry) => (
                    <li key={entry.id} className={styles.row}>
                        <div className={styles.summary}>
                            <span className={styles.summaryText}>{entry.summary}</span>
                            <span className={styles.meta}>
                                {entry.chainId} · signed {ageString(entry.signedAt)}
                            </span>
                        </div>
                        <div className={styles.actions}>
                            <button
                                type="button"
                                className={styles.broadcastBtn}
                                onClick={() => broadcast(entry.id)}
                                disabled={busyId === entry.id}
                            >
                                {busyId === entry.id ? 'Broadcasting…' : 'Broadcast now'}
                            </button>
                            <button
                                type="button"
                                className={styles.discardBtn}
                                onClick={() => discard(entry.id)}
                                disabled={busyId === entry.id}
                            >
                                Discard
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
            {error ? (
                <div role="alert" className={styles.error}>{error}</div>
            ) : null}
        </div>
    );
}

function ageString(signedAt) {
    if (typeof signedAt !== 'number' || !Number.isFinite(signedAt)) return 'just now';
    const diffMs = Math.max(0, Date.now() - signedAt);
    if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s ago`;
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
    return `${Math.round(diffMs / 3_600_000)}h ago`;
}
