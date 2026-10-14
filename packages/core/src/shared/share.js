// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyText } from './clipboard.js';

export const ShareOutcome = Object.freeze({
    SHARED: 'shared',
    COPIED: 'copied',
    CANCELLED: 'cancelled',
    UNAVAILABLE: 'unavailable',
});

/**
 * Offers content to the platform share sheet and copies the useful plain-text
 * form when sharing is unavailable. Closing the share sheet remains silent.
 *
 * @param {ShareData} data
 * @param {string} fallbackText
 * @param {{ env?: any }} [opts]
 * @returns {Promise<string>}
 */
export async function shareOrCopy(data, fallbackText, { env = globalThis } = {}) {
    const share = env?.navigator?.share;
    if (typeof share === 'function') {
        try {
            await share.call(env.navigator, data);
            return ShareOutcome.SHARED;
        } catch (err) {
            if (err?.name === 'AbortError') return ShareOutcome.CANCELLED;
        }
    }

    const { ok } = await copyText(fallbackText, { env });
    return ok ? ShareOutcome.COPIED : ShareOutcome.UNAVAILABLE;
}
