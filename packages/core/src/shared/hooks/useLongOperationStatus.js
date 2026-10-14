// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * Gives long-running UI work one consistent elapsed-time and timeout clock.
 * The timeout is advisory because signing and broadcast calls can finish after
 * the client stops receiving updates, when aborting would make their outcome
 * ambiguous.
 *
 * @param {boolean} active
 * @param {{ revealAfterMs?: number, timeoutMs?: number }} [options]
 */
export function useLongOperationStatus(active, options = {}) {
    const revealAfterMs = options.revealAfterMs ?? 3_000;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const [elapsedMs, setElapsedMs] = useState(0);

    useEffect(() => {
        if (!active) {
            setElapsedMs(0);
            return undefined;
        }
        const startedAt = Date.now();
        setElapsedMs(0);
        const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
        const id = setInterval(update, 1_000);
        return () => clearInterval(id);
    }, [active]);

    return {
        elapsedSeconds: Math.floor(elapsedMs / 1_000),
        showElapsed: active && elapsedMs >= revealAfterMs,
        timedOut: active && elapsedMs >= timeoutMs,
    };
}
