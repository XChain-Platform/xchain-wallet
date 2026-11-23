// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: MIT

export const QR_MAX_CHARS = 2900;

export const PICKS = Object.freeze(['app', 'web', 'get']);

export function qrOffered(linkLength) {
    return Number.isInteger(linkLength) && linkLength >= 1 && linkLength <= QR_MAX_CHARS;
}

export function createPickMemory(storage, origin) {
    const key = `xchain-connect-pick:${origin}`;

    return {
        get() {
            const pick = storage.getItem(key);
            return PICKS.includes(pick) ? pick : null;
        },

        set(pick) {
            if (!PICKS.includes(pick)) {
                throw new TypeError('pick must be app, web, or get');
            }
            storage.setItem(key, pick);
        },
    };
}
