// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyText } from './clipboard.js';
import { getNativePlugin } from './nativeShell.js';

export const ShareOutcome = Object.freeze({
    SHARED: 'shared',
    COPIED: 'copied',
    CANCELED: 'canceled',
    UNAVAILABLE: 'unavailable',
});

/**
 * Share public content through the strongest platform surface available.
 * Native shells own the first attempt because their WebViews may omit the Web
 * Share API even though the operating system has a share sheet.
 *
 * @param {{ title?: string, text?: string, url?: string, files?: File[] }} data
 * @param {{ env?: any, fallbackText?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function shareContent(data, { env = globalThis, fallbackText } = {}) {
    const nativeApp = getNativePlugin('App', { env, method: 'share' });
    if (nativeApp) {
        try {
            const result = await nativeApp.share({
                title: String(data?.title || ''),
                text: String(data?.text || ''),
                url: String(data?.url || ''),
            });
            return result?.completed === false
                ? ShareOutcome.CANCELED
                : ShareOutcome.SHARED;
        } catch { /* try the Web Share API */ }
    }

    const nav = env?.navigator;
    if (typeof nav?.share === 'function') {
        try {
            await nav.share(data);
            return ShareOutcome.SHARED;
        } catch (err) {
            if (err?.name === 'AbortError') return ShareOutcome.CANCELED;
        }
    }

    if (fallbackText !== undefined) {
        const { ok } = await copyText(fallbackText, { env });
        if (ok) return ShareOutcome.COPIED;
    }
    return ShareOutcome.UNAVAILABLE;
}
