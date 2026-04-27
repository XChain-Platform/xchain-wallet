// StalenessLabel — §49.3 / G155.
//
// Renders "Last synced Xs ago" copy next to a balance or history
// surface so the user can tell at a glance whether the data they're
// looking at is live or cached. The component is purely presentational
// — pass the timestamp of the last successful fetch (Unix ms) and a
// label prefix; the staleness math runs locally on a self-refreshing
// timer so the text updates without parent re-renders.
//
// Per §49.3 the wallet "never fabricates data" — so callers should pass
// `lastSyncedAt = null` when they have no fetch history yet, and the
// component renders nothing rather than misleading copy.

import { useEffect, useState } from 'react';
import styles from './StalenessLabel.module.css';

const TICK_MS = 30_000;

/**
 * @param {object} props
 * @param {number | null} props.lastSyncedAt    Unix ms of last successful fetch; null = no data yet.
 * @param {string} [props.prefix]               Optional copy prefix; defaults to "Last synced".
 * @param {number} [props.warnAfterMs]          Optional staleness threshold; styles the label as a warning past this.
 * @param {string} [props.className]            Caller-supplied class for layout adjustment.
 */
export function StalenessLabel({ lastSyncedAt, prefix = 'Last synced', warnAfterMs, className }) {
    const [, setTick] = useState(0);

    useEffect(() => {
        if (lastSyncedAt === null || lastSyncedAt === undefined) return undefined;
        const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
        return () => clearInterval(id);
    }, [lastSyncedAt]);

    if (lastSyncedAt === null || lastSyncedAt === undefined) return null;

    const diffMs = Math.max(0, Date.now() - lastSyncedAt);
    const stale = typeof warnAfterMs === 'number' && diffMs >= warnAfterMs;
    const text = `${prefix} ${formatAgo(diffMs)} ago`;

    return (
        <span
            className={`${styles.label} ${stale ? styles.stale : ''} ${className || ''}`}
            role="status"
            aria-live="off"
            title={new Date(lastSyncedAt).toISOString()}
        >
            {text}
        </span>
    );
}

/** Exported for the smoke test + reuse in callers that build their own copy. */
export function formatAgo(diffMs) {
    if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`;
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
    if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h`;
    return `${Math.round(diffMs / 86_400_000)}d`;
}
