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
