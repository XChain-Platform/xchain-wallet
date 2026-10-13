// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// StalenessLabel (§49.3 / G155).
//
// Renders one freshness pattern next to saved data so the user can tell at a
// glance whether it is current or being shown offline. Pass the timestamp of
// the last successful fetch (Unix ms); the staleness math runs locally on a
// self-refreshing timer so the text updates without parent re-renders.
//
// Per §49.3 the wallet "never fabricates data", so callers should pass
// `lastSyncedAt = null` when they have no fetch history yet, and the
// component renders nothing rather than misleading copy.

import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { formatElapsedTime, formatLocalDateTime } from '../utils/dateTime.js';
import styles from './StalenessLabel.module.css';

const TICK_MS = 30_000;
const EXACT_VISIBLE_MS = 2_500;

/**
 * @param {object} props
 * @param {number | null} props.lastSyncedAt    Unix ms of last successful fetch; null = no data yet.
 * @param {number} [props.warnAfterMs]          Optional staleness threshold; styles the label as a warning past this.
 * @param {string} [props.className]            Caller-supplied class for layout adjustment.
 */
export function StalenessLabel({ lastSyncedAt, warnAfterMs, className }) {
    const [, setTick] = useState(0);
    const [showExact, setShowExact] = useState(false);
    const revealTimer = useRef(null);
    const online = useOnlineStatus();

    useEffect(() => {
        if (!online || lastSyncedAt === null || lastSyncedAt === undefined) return undefined;
        const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
        return () => clearInterval(id);
    }, [lastSyncedAt, online]);

    useEffect(() => () => clearTimeout(revealTimer.current), []);

    if (lastSyncedAt === null || lastSyncedAt === undefined) return null;

    const diffMs = Math.max(0, Date.now() - lastSyncedAt);
    const stale = !online || (typeof warnAfterMs === 'number' && diffMs >= warnAfterMs);
    const text = online ? `Updated ${formatAgo(diffMs)}` : 'Offline, showing saved data';
    const exact = formatLocalDateTime(lastSyncedAt);
    const visibleText = showExact && exact ? `Last updated ${exact}` : text;

    const revealForTouch = (event) => {
        if (event.pointerType === 'mouse') return;
        clearTimeout(revealTimer.current);
        setShowExact(true);
        revealTimer.current = setTimeout(() => setShowExact(false), EXACT_VISIBLE_MS);
    };

    return (
        <span
            className={`${styles.label} ${stale ? styles.stale : ''} ${className || ''}`}
            role="status"
            aria-live="off"
            aria-label={exact ? `${text}. Last synced: ${exact}` : text}
            title={exact || undefined}
            tabIndex={0}
            onFocus={() => setShowExact(true)}
            onBlur={() => setShowExact(false)}
            onKeyDown={(event) => {
                if (event.key === 'Escape') event.currentTarget.blur();
            }}
            onPointerUp={revealForTouch}
        >
            {visibleText}
        </span>
    );
}

/** Exported for the smoke test + reuse in callers that build their own copy. */
export function formatAgo(diffMs) {
    return formatElapsedTime(diffMs);
}
