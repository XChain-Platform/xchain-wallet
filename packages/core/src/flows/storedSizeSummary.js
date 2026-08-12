// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// storedSizeSummary (§8): what the file ACTUALLY cost on chain.
//
// Compression is on by default, so the bytes that land are routinely a fraction
// of the file the user picked, and the user has no way to know that from their
// own request. §8 makes it the wallet's job to "show the real on-chain size".
//
// The encoder reports it rather than the wallet inferring it, which matters
// because inference would be wrong in both directions: §5.2 keeps the compressed
// form only when it is smaller, so a request to compress does not mean the bytes
// were compressed, and the default being ON means not asking does not mean they
// were not. The report shape is { compressed, rawLength, storedLength, reason }.
//
// Pure and total: it never throws and always returns something renderable, so a
// success screen can never be broken by a missing or malformed report. When
// there is nothing trustworthy to say it returns null and the caller shows
// nothing, which is better than showing a number that might be wrong.

/**
 * @typedef {{ compressed?: boolean, rawLength?: number, storedLength?: number,
 *             reason?: string|null }} CompressionReport
 */

/**
 * @typedef {{ storedBytes: number, originalBytes: number, compressed: boolean,
 *             ratio: number|null, savedBytes: number, savedPercent: number|null,
 *             reason: string|null }} StoredSizeSummary
 */

const finite = (n) => Number.isFinite(Number(n)) && Number(n) >= 0;

/**
 * Normalize an encoder compression report into something a screen can render.
 *
 * @param {CompressionReport | null | undefined} report
 * @param {number} [fallbackOriginalBytes] - the file size the caller already
 *   knows, used when the report omits rawLength
 * @returns {StoredSizeSummary | null} null when nothing trustworthy can be said
 */
export function storedSizeSummary(report, fallbackOriginalBytes) {
    const r = (report && typeof report === 'object') ? report : null;

    const originalBytes = finite(r?.rawLength) ? Number(r.rawLength)
        : (finite(fallbackOriginalBytes) ? Number(fallbackOriginalBytes) : null);
    if (originalBytes === null) return null;

    // No stored length means the encoder did not report one; fall back to the
    // original only when it also told us nothing was compressed, because then the
    // two are genuinely the same number. Otherwise say nothing.
    const compressed = r?.compressed === true;
    const storedBytes = finite(r?.storedLength) ? Number(r.storedLength)
        : (r && !compressed ? originalBytes : null);
    if (storedBytes === null) return null;

    const savedBytes = Math.max(0, originalBytes - storedBytes);
    return {
        storedBytes,
        originalBytes,
        compressed,
        // Guard the division rather than emit Infinity into a UI string.
        ratio: storedBytes > 0 ? originalBytes / storedBytes : null,
        savedBytes,
        savedPercent: originalBytes > 0 ? (savedBytes / originalBytes) * 100 : null,
        reason: typeof r?.reason === 'string' && r.reason ? r.reason : null,
    };
}

/**
 * One plain-language line for a success screen. Deliberately states the stored
 * size FIRST, because that is the number the user is paying for and the one they
 * cannot otherwise discover.
 *
 * @param {StoredSizeSummary | null} summary
 * @returns {string | null}
 */
export function storedSizeLine(summary) {
    if (!summary) return null;
    const stored = summary.storedBytes.toLocaleString();
    const original = summary.originalBytes.toLocaleString();
    if (!summary.compressed) {
        return `Stored on-chain: ${stored} bytes (this file does not compress, so it is stored as-is).`;
    }
    const pct = summary.savedPercent === null ? null : Math.round(summary.savedPercent);
    return `Stored on-chain: ${stored} bytes, compressed from ${original}`
        + (pct === null ? '.' : ` (${pct}% smaller).`);
}
