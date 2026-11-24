// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The host side of the About panel's update check for a shell whose page may
// not fetch. It takes no request, fetches the one release-feed address and
// returns the body text, so it cannot be aimed at another URL. The panel
// validates the text; this only moves bytes, within the same size cap.

import { WALLET_RELEASE_FEED_URL } from '@xchain-wallet/core/branding/branding.js';

/** Matches the panel's own cap on a feed body. */
export const RELEASE_FEED_MAX_BYTES = 4096;
const RELEASE_FEED_TIMEOUT_MS = 8000;

async function readCapped(response, maxBytes) {
    if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        return typeof text === 'string' && text.length <= maxBytes ? text : null;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
}

/**
 * @param {{ fetch?: typeof globalThis.fetch, timeoutMs?: number }} [deps]
 * @returns {() => Promise<{ ok: true, text: string } | { ok: false, status: number, error: string }>}
 */
export function createReleaseFeedHandler({ fetch = (...args) => globalThis.fetch(...args), timeoutMs = RELEASE_FEED_TIMEOUT_MS } = {}) {
    return async function releaseFeed() {
        if (typeof fetch !== 'function') return { ok: false, status: 0, error: 'fetch unavailable' };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(WALLET_RELEASE_FEED_URL, {
                method: 'GET',
                cache: 'no-store',
                redirect: 'error',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            });
            if (!response?.ok) return { ok: false, status: Number(response?.status) || 0, error: 'feed unavailable' };
            const text = await readCapped(response, RELEASE_FEED_MAX_BYTES);
            if (text === null) return { ok: false, status: response.status, error: 'feed too large' };
            return { ok: true, text };
        } catch (err) {
            return { ok: false, status: 0, error: err?.message ? String(err.message) : String(err) };
        } finally {
            clearTimeout(timeoutId);
        }
    };
}
