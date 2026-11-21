// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

function canonicalize(value, omitKeys, topLevel = false) {
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, omitKeys));
    if (!value || typeof value !== 'object') return value;

    const entries = Object.keys(value)
        .filter((key) => !topLevel || !omitKeys.has(key))
        .sort()
        .map((key) => [key, canonicalize(value[key], omitKeys)]);
    return Object.fromEntries(entries);
}

/**
 * Hash JSON-compatible content with stable object-key ordering.
 *
 * @param {unknown} value
 * @param {string[]} [omitKeys]
 * @returns {string}
 */
export function watchContentHash(value, omitKeys = []) {
    const canonicalJson = JSON.stringify(canonicalize(value, new Set(omitKeys), true));
    return bytesToHex(sha256(new TextEncoder().encode(canonicalJson)));
}
