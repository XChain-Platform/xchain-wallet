// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Returns an absolute HTTP(S) URL or null for values that must not become links.
 * Parsing rejects relative and malformed destinations while the protocol check
 * excludes active schemes such as javascript: and data:.
 */
export function safeHttpUrl(value) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    if (!candidate) return null;
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? candidate
            : null;
    } catch {
        return null;
    }
}

// Base64 data: URLs of the picture formats the byte sniffer recognizes; an
// <img> shows them with no script context (SVG included), and they are what a
// token's on-chain picture FILE becomes.
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Returns a value safe as an <img src>: an absolute HTTP(S) URL or a base64
 * picture data: URL. Never use the result as a link; open it only when
 * safeHttpUrl also accepts it.
 */
export function safeImageSrc(value) {
    if (typeof value === 'string' && IMAGE_DATA_URL_RE.test(value.trim())) return value.trim();
    return safeHttpUrl(value);
}
