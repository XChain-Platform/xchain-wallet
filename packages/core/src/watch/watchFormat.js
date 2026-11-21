// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function ageBucket(balancesAt, now) {
    const elapsedMs = Math.max(0, now - balancesAt);
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    const amber = elapsedMs > 15 * 60_000;

    if (elapsedMs < 60_000) return { bucket: 'justNow', n: 0, amber };
    if (elapsedMinutes < 60) return { bucket: 'minutes', n: elapsedMinutes, amber };

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return { bucket: 'hours', n: elapsedHours, amber };
    return { bucket: 'day', n: elapsedHours, amber };
}
