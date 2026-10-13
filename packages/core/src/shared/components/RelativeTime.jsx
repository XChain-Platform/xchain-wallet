// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import {
    formatActivityTime,
    formatLocalDateTime,
} from '../utils/dateTime.js';

const TICK_MS = 30_000;
const LONG_PRESS_MS = 500;
const EXACT_VISIBLE_MS = 2_500;

/**
 * Keep an activity timestamp current and expose its exact local time.
 * Children may wrap the changing label in translated surrounding copy.
 *
 * @param {object} props
 * @param {unknown} props.timestamp
 * @param {string} [props.className]
 * @param {(label: string) => import('react').ReactNode} [props.children]
 */
export function RelativeTime({ timestamp, className, children }) {
    const [nowMs, setNowMs] = useState(Date.now);
    const [showExact, setShowExact] = useState(false);
    const pressTimer = useRef(null);
    const revealTimer = useRef(null);
    const label = formatActivityTime(timestamp, nowMs);
    const exact = formatLocalDateTime(timestamp);

    useEffect(() => {
        if (!label || label === exact) return undefined;
        const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [exact, label, timestamp]);

    useEffect(() => {
        setShowExact(false);
        return () => {
            clearTimeout(pressTimer.current);
            clearTimeout(revealTimer.current);
        };
    }, [timestamp]);

    if (!label || !exact) return null;

    const content = showExact ? exact : label;
    const rendered = children ? children(content) : content;
    const numeric = Number(timestamp);
    const ms = Number.isFinite(numeric) && numeric > 0
        ? (numeric < 1e12 ? numeric * 1000 : numeric)
        : Date.parse(String(timestamp));
    const onPointerDown = (event) => {
        if (event.pointerType === 'mouse') return;
        clearTimeout(pressTimer.current);
        clearTimeout(revealTimer.current);
        pressTimer.current = setTimeout(() => {
            setShowExact(true);
            revealTimer.current = setTimeout(() => setShowExact(false), EXACT_VISIBLE_MS);
        }, LONG_PRESS_MS);
    };
    const cancelPress = () => clearTimeout(pressTimer.current);

    return (
        <time
            className={className}
            dateTime={Number.isNaN(ms) ? undefined : new Date(ms).toISOString()}
            title={exact}
            aria-label={`${label}. Exact time: ${exact}`}
            onPointerDown={onPointerDown}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
        >
            {rendered}
        </time>
    );
}
