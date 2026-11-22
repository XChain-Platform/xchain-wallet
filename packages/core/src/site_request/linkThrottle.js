// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createLinkThrottle({ limit = 5, windowMs = 60000, now = Date.now } = {}) {
    const takenAt = [];

    return {
        take() {
            const takenAtMs = now();
            const cutoff = takenAtMs - windowMs;

            while (takenAt.length > 0 && takenAt[0] <= cutoff) takenAt.shift();

            if (takenAt.length >= limit) {
                return { ok: false, retryInMs: takenAt[0] + windowMs - takenAtMs };
            }

            takenAt.push(takenAtMs);
            return { ok: true };
        },
    };
}
