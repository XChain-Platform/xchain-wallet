// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Opaque, single-use handles for files the user picked.
//
// The preload turns a picked File into an absolute path inside its own isolated
// world and registers that path here; the page only ever holds the token. Main
// opens a file for an upload only through a token it issued, so a page script
// cannot name a path of its own choosing.

import { randomBytes as nodeRandomBytes } from 'node:crypto';

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 64;

/**
 * @param {{ now?: () => number, ttlMs?: number, maxEntries?: number, randomBytes?: (size: number) => Buffer }} [opts]
 */
export function createPickedFileTokenStore({
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    randomBytes = nodeRandomBytes,
} = {}) {
    /** @type {Map<string, { path: string, size: number, mtimeMs: number, expiresAt: number }>} */
    const entries = new Map();

    function dropExpired() {
        const at = now();
        for (const [token, entry] of entries) {
            if (entry.expiresAt <= at) entries.delete(token);
        }
    }

    return {
        /** @param {{ path: string, size: number, mtimeMs: number }} file */
        issue({ path, size, mtimeMs }) {
            dropExpired();
            const token = randomBytes(32).toString('base64url');
            entries.set(token, { path, size, mtimeMs, expiresAt: now() + ttlMs });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
            return token;
        },
        /**
         * Hands the entry back once. A second take, an unknown token and an
         * expired one all answer null.
         * @param {unknown} token
         */
        take(token) {
            if (typeof token !== 'string') return null;
            const entry = entries.get(token);
            if (!entry) return null;
            entries.delete(token);
            return entry.expiresAt > now() ? entry : null;
        },
        get size() {
            return entries.size;
        },
    };
}

/** The one store main shares between the registration channel and the message host. */
export const pickedFileTokens = createPickedFileTokenStore();
