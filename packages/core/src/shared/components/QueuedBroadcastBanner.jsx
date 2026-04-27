// QueuedBroadcastBanner — §49.5 / G154.
//
// Surfaces signed transactions that were queued for broadcast — typically
// because the user was offline when they signed. Each row exposes
// "Broadcast now" and "Discard" affordances and clears itself from the
// queue on action. Hidden when the queue is empty, so it costs nothing
// in the normal case.
//
// v0.170.0 ships the UI + the messaging surface; the auto-enqueue piece
// (Send / action paths detecting offline broadcast failures and pushing
// signed hex into the queue instead of bubbling the error) is a Cluster
// G FOLLOWUP, so the banner is reachable but typically empty until that
// lands. Marking G154 🟡 partial in the ledger reflects that.

import { useCallback, useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
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
        <div role="status" aria-live="polite" className={styles.banner}>
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
