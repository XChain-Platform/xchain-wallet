// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// QueuedBroadcastBanner (§49.5 / G154).
//
// Surfaces signed transactions that were queued for broadcast, typically
// because the user was offline when they signed. Each row exposes
// "Send now" and "Remove" affordances and clears itself from the
// queue on action. Hidden when the queue is empty, so it costs nothing
// in the normal case.
//
// History: v0.170.0 shipped the UI + messaging surface; v0.292.0 wired
// auto-enqueue from action.* broadcast failures (Cluster G FOLLOWUP 1);
// v0.293.0 moved the queue into chrome.storage.local / localStorage so
// it survives reload (Cluster G FOLLOWUP 2); v0.294.0 adds the §49.5
// reconnection prompt: when reachability flips offline/degraded →
// normal AND the queue is non-empty, surface a one-shot toast with a
// "Review" action so the user knows the transactions are ready to send.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChainBadge, useReducedMotion } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';
import { useReachability } from '../hooks/useReachability.js';
import { useToast } from './ToastHost.jsx';
import { broadcastFailureKindFromError } from '../../flows/broadcastPermanence.js';
import styles from './QueuedBroadcastBanner.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {number} [props.intervalMs]   how often to re-list the queue (defaults to 30s)
 */
export function QueuedBroadcastBanner({ walletId, intervalMs = 30_000 }) {
    const { messaging } = useMessaging();
    const [queue, setQueue] = useState(/** @type {any[]} */ ([]));
    const [busyId, setBusyId] = useState(/** @type {string | null} */ (null));
    const [busyKind, setBusyKind] = useState(/** @type {'send' | 'remove' | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const titleId = useId();
    // Cluster G FOLLOWUP 3: reconnection prompt. Track previous
    // reachability `overall` so a transition `offline|degraded → normal`
    // with a non-empty queue surfaces a one-shot toast nudging the user
    // to broadcast.
    const { overall: reachabilityOverall } = useReachability({});
    const { showToast } = useToast();
    const reducedMotion = useReducedMotion();
    const prevOverallRef = useRef(/** @type {string | null} */ (null));
    const lastPromptedAtRef = useRef(/** @type {number} */ (0));
    const bannerRef = useRef(/** @type {HTMLElement | null} */ (null));
    const mountedRef = useRef(false);
    const currentInputRef = useRef({ messaging, walletId });
    const refreshRequestRef = useRef(0);
    const actionRef = useRef(/** @type {object | null} */ (null));
    const queueWalletRef = useRef(walletId);
    const normalizedQueueRef = useRef({ source: null, shown: /** @type {any[]} */ ([]) });
    currentInputRef.current = { messaging, walletId };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            refreshRequestRef.current += 1;
        };
    }, []);

    // Re-list the queue; resolves the list shown, or null when it could not be read.
    const refresh = useCallback(async () => {
        if (!walletId || typeof messaging?.listQueuedBroadcasts !== 'function') return null;
        const requestId = ++refreshRequestRef.current;
        try {
            const list = await messaging.listQueuedBroadcasts({ walletId });
            let shown = normalizedQueueRef.current.shown;
            if (normalizedQueueRef.current.source !== list) {
                if (Array.isArray(list)) {
                    const seenIds = new Set();
                    shown = list.filter((entry) => {
                        if (seenIds.has(entry?.id)) return false;
                        seenIds.add(entry?.id);
                        return true;
                    });
                } else {
                    shown = [];
                }
                normalizedQueueRef.current = { source: list, shown };
            }
            const current = currentInputRef.current;
            if (mountedRef.current
                && current.messaging === messaging
                && current.walletId === walletId
                && refreshRequestRef.current === requestId) {
                setQueue(shown);
            }
            return shown;
        } catch (_err) {
            // The list endpoint is read-only; failures here surface
            // through the reachability banner instead.
            return null;
        }
    }, [messaging, walletId]);

    useEffect(() => {
        if (queueWalletRef.current !== walletId) {
            queueWalletRef.current = walletId;
            normalizedQueueRef.current = { source: null, shown: [] };
            setQueue([]);
            setError(null);
        }
        void refresh();
        if (intervalMs > 0) {
            const id = setInterval(() => { void refresh(); }, intervalMs);
            return () => {
                clearInterval(id);
                refreshRequestRef.current += 1;
            };
        }
        return () => { refreshRequestRef.current += 1; };
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
                ? '1 transaction is ready to send.'
                : `${queue.length} transactions are ready to send.`,
            actionLabel: 'Review',
            onAction: () => {
                const sendButton = bannerRef.current?.querySelector('[data-queued-send]');
                if (sendButton && typeof sendButton.focus === 'function') {
                    sendButton.focus();
                    bannerRef.current.scrollIntoView({
                        block: 'center',
                        behavior: reducedMotion ? 'auto' : 'smooth',
                    });
                }
            },
            durationMs: 12_000,
        });
    }, [reachabilityOverall, queue.length, reducedMotion, showToast]);

    if (queue.length === 0) return null;

    async function broadcast(id) {
        if (actionRef.current) return;
        const action = { messaging, walletId };
        actionRef.current = action;
        setBusyId(id);
        setBusyKind('send');
        setError(null);
        try {
            await messaging.broadcastQueuedRequest({ walletId, id });
            if (!isCurrentAction(action)) return;
            const list = await refresh();
            if (!isCurrentAction(action)) return;
            if (!list) setQueue((prev) => prev.filter((entry) => entry.id !== id));
            showToast({ message: 'Transaction sent.', variant: 'success' });
        } catch (err) {
            if (!isCurrentAction(action)) return;
            // Re-list first: the host removes the entry before it throws on a
            // permanent rejection or a refused claim, so the row may be gone.
            const list = await refresh();
            if (!isCurrentAction(action)) return;
            const outcome = queuedBroadcastFailure(err, list, id);
            if (outcome.removed) {
                // The row is gone, so tell the user in a toast rather than under a list without it.
                if (!list) setQueue((prev) => prev.filter((entry) => entry.id !== id));
                showToast({ message: outcome.message, variant: 'error', durationMs: 12_000 });
            } else {
                setError(outcome.message);
            }
        } finally {
            if (actionRef.current === action) actionRef.current = null;
            if (mountedRef.current) {
                setBusyId(null);
                setBusyKind(null);
            }
        }
    }
    async function discard(id) {
        if (actionRef.current) return;
        const action = { messaging, walletId };
        actionRef.current = action;
        setBusyId(id);
        setBusyKind('remove');
        setError(null);
        try {
            await messaging.discardQueuedRequest({ walletId, id });
            if (!isCurrentAction(action)) return;
            const list = await refresh();
            if (!isCurrentAction(action)) return;
            if (!list) setQueue((prev) => prev.filter((entry) => entry.id !== id));
            showToast({ message: 'Transaction removed from the queue.' });
        } catch (_err) {
            if (!isCurrentAction(action)) return;
            // Re-list so a row the host already removed does not linger.
            const list = await refresh();
            if (!isCurrentAction(action)) return;
            const removed = Array.isArray(list) && !list.some((entry) => entry?.id === id);
            if (removed) {
                showToast({ message: 'Transaction removed from the queue.' });
            } else {
                setError(list
                    ? 'Could not remove this transaction. It is still waiting to send.'
                    : 'Could not confirm whether this transaction was removed. Check the queue again.');
            }
        } finally {
            if (actionRef.current === action) actionRef.current = null;
            if (mountedRef.current) {
                setBusyId(null);
                setBusyKind(null);
            }
        }
    }

    function isCurrentAction(action) {
        const current = currentInputRef.current;
        return mountedRef.current
            && current.messaging === action.messaging
            && current.walletId === action.walletId;
    }

    return (
        <section
            ref={bannerRef}
            aria-labelledby={titleId}
            className={styles.banner}
        >
            <div
                id={titleId}
                className={styles.title}
            >
                Waiting to send ({queue.length})
            </div>
            <ul className={styles.list}>
                {queue.map((entry) => (
                    <li key={entry.id} className={styles.row}>
                        <div className={styles.summary}>
                            <span className={styles.summaryText}>{entry.summary}</span>
                            <span className={styles.meta}>
                                {chainLabel(entry.chainId)} · signed {ageString(entry.signedAt)}
                            </span>
                            {/* A resumed claim is a send the wallet had already handed to
                                the network when it was interrupted, so it may have landed.
                                Saying so is the point of the flag: the row offers a re-send
                                of the IDENTICAL bytes, which a node already holding them
                                rejects as already known, and never a re-compose, which is
                                the action on this path that can spend twice. */}
                            {entry.resumedClaim ? (
                                <span className={styles.meta}>
                                    Sending was interrupted, so this may already have been
                                    sent. Sending it again is safe and cannot pay twice.
                                </span>
                            ) : null}
                        </div>
                        <div className={styles.actions}>
                            <button
                                type="button"
                                className={styles.broadcastBtn}
                                onClick={() => broadcast(entry.id)}
                                disabled={busyId !== null}
                                data-queued-send
                                aria-label={busyId === entry.id && busyKind === 'send'
                                    ? `Sending: ${entry.summary}`
                                    : `Send now: ${entry.summary}`}
                            >
                                {busyId === entry.id
                                    ? 'Sending…'
                                    : (entry.resumedClaim ? 'Try sending again' : 'Send now')}
                            </button>
                            <button
                                type="button"
                                className={styles.discardBtn}
                                onClick={() => discard(entry.id)}
                                disabled={busyId !== null}
                                aria-label={busyId === entry.id && busyKind === 'remove'
                                    ? `Removing from queue: ${entry.summary}`
                                    : `Remove from queue: ${entry.summary}`}
                            >
                                {busyId === entry.id && busyKind === 'remove' ? 'Removing…' : 'Remove'}
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
            {error ? (
                <div role="alert" className={styles.error}>{error}</div>
            ) : null}
        </section>
    );
}

/**
 * Word a failed send from the host's verdict and the queue re-listed after it.
 *
 * Never tells the user to compose a fresh transaction: an entry the host refused
 * as no longer queued may already have reached a node, and a re-compose can pay twice.
 *
 * @param {unknown} err          what the broadcast route threw
 * @param {any[] | null} list    the re-listed queue; null when it could not be read
 * @param {string} id            the entry the user tried to send
 * @returns {{ removed: boolean, message: string }}  `removed` when the row has left the queue
 */
export function queuedBroadcastFailure(err, list, id) {
    const kind = broadcastFailureKindFromError(err);
    const listed = Array.isArray(list) ? list.some((entry) => entry?.id === id) : null;
    // Trust the re-listed queue; without one, a permanent verdict means the host dropped it.
    const removed = listed === false || (listed === null && kind === 'permanent');
    if (removed && kind === 'permanent') {
        return {
            removed,
            message: 'The network refused this transaction for good, so it was removed from the queue. '
                + 'Check your activity first: it may already have gone through.',
        };
    }
    if (removed) {
        return {
            removed,
            message: 'This transaction is no longer in the queue and was not sent this time. '
                + 'Check your activity to see what happened to it.',
        };
    }
    if (kind === 'transient') {
        return {
            removed,
            message: 'Sending failed, and the transaction is still queued. '
                + 'You can try sending it again once the network is reachable.',
        };
    }
    return {
        removed,
        message: 'Could not send this transaction. It is still waiting to send. Try again.',
    };
}

// Name the chain the way every other screen does (the raw id shows only
// when the registry has no entry for it).
function chainLabel(chainId) {
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    return descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId;
}

function ageString(signedAt) {
    if (typeof signedAt !== 'number' || !Number.isFinite(signedAt)) return 'just now';
    const diffMs = Math.max(0, Date.now() - signedAt);
    if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s ago`;
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
    return `${Math.round(diffMs / 3_600_000)}h ago`;
}
