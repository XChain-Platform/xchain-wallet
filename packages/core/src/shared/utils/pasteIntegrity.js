// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Paste-integrity check — §21.5 / §12.3.
//
// Defense against clipboard-hijack patterns where malware monitors the
// OS clipboard for crypto address strings and silently swaps them.
// `event.clipboardData` gives us the value at paste time. We then
// re-read `navigator.clipboard.readText()` and compare hashes. If the
// clipboard rewrote itself between the two reads, that's a strong
// signal something is poking the clipboard while the user is acting
// on it.
//
// The check is best-effort: clipboard read access is permission-gated
// in some browser contexts (insecure http origins, Firefox without
// user gesture, etc.). When the read isn't available we silently
// skip. The lookalike check (`./lookalike.js`) is the wider net.

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * SHA-256 hex over the UTF-8 bytes of `text`. Stable across runs;
 * comparable across reads.
 *
 * @param {string} text
 * @returns {string} hex
 */
export function hashText(text) {
    if (typeof text !== 'string') return '';
    const bytes = new TextEncoder().encode(text);
    return bytesToHex(sha256(bytes));
}

/**
 * @typedef {object} IntegrityResult
 * @property {boolean} ok            false ⇒ mismatch detected
 * @property {boolean} [skipped]     true ⇒ no clipboard re-read possible (no permission, no API)
 * @property {string} [pastedHash]
 * @property {string} [reread]       the re-read clipboard text when mismatch is detected
 * @property {string} [rereadHash]
 * @property {string} [reason]
 */

/**
 * Cross-check the value the paste event delivered against the actual
 * clipboard contents one frame later.
 *
 * Caller passes the `pastedText` it received from
 * `event.clipboardData.getData('text')`. This function hashes it,
 * tries to read the clipboard again via `navigator.clipboard.readText`,
 * and compares. Any failure path (no Clipboard API, permission denied,
 * read returns the same value) returns `{ ok: true }` (with `skipped`
 * set when no comparison was possible).
 *
 * @param {{ pastedText: string, clipboard?: { readText?: () => Promise<string> } }} opts
 * @returns {Promise<IntegrityResult>}
 */
export async function checkPasteIntegrity({ pastedText, clipboard } = {}) {
    if (typeof pastedText !== 'string') return { ok: true, skipped: true };
    const pastedHash = hashText(pastedText);

    const cb = clipboard
        || (typeof navigator !== 'undefined' && navigator.clipboard)
        || null;
    if (!cb || typeof cb.readText !== 'function') {
        return { ok: true, skipped: true, pastedHash };
    }
    let reread;
    try {
        reread = await cb.readText();
    } catch {
        return { ok: true, skipped: true, pastedHash };
    }
    if (typeof reread !== 'string') {
        return { ok: true, skipped: true, pastedHash };
    }
    const rereadHash = hashText(reread);
    if (rereadHash === pastedHash) {
        return { ok: true, pastedHash, rereadHash };
    }
    return {
        ok: false,
        pastedHash,
        reread,
        rereadHash,
        reason: 'Clipboard contents changed between paste and re-read.',
    };
}
