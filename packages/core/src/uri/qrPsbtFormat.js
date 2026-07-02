// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// QR PSBT format detector (§20.4 / G043).
//
// A scanner can receive PSBT frames in any of three formats today:
//
//   • XCW: the wallet's own chunked transport (`XCW:n/total:crc:b64`)
//   • BBQr: Sparrow / Coldcard / SeedSigner standard
//           (`B$EFNNXX<payload>`)
//   • UR: Foundation Passport / Keystone CBOR-bytewords format
//         (`ur:crypto-psbt/...`), including the fountain-coded
//         multi-part variant (decoded by urPsbt.js)
//
// `detectQrFrameFormat(frame)` returns the format name (or null when
// the frame matches none of the known prefixes). Callers dispatch on
// the answer and route the frame to the right collector. All three
// formats decode today (XCW; BBQr H/B/Z as of Cluster U FOLLOWUP 1; UR
// as of Cluster U FOLLOWUP 2), so `describeUnsupportedFormat` no longer
// flags any of them; it is retained for any future format added ahead
// of its decoder.

export const QR_PSBT_FORMATS = /** @type {const} */ (['xcw', 'bbqr', 'ur']);

/**
 * @param {string} frame
 * @returns {'xcw' | 'bbqr' | 'ur' | null}
 */
export function detectQrFrameFormat(frame) {
    if (typeof frame !== 'string') return null;
    const trimmed = frame.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('XCW:')) return 'xcw';
    if (trimmed.startsWith('B$') && trimmed.length >= 8) return 'bbqr';
    if (/^ur:/i.test(trimmed)) return 'ur';
    return null;
}

/**
 * Human-readable diagnostic for a frame that detected as a known
 * format but cannot be decoded yet. Used by the shell layer to
 * differentiate "garbage frame" (return null from detect) from
 * "recognized but unsupported format" (specific error message).
 *
 * @param {'xcw' | 'bbqr' | 'ur' | null | string} format
 * @returns {string | null}
 */
export function describeUnsupportedFormat(format) {
    // XCW, BBQr (H/B/Z), and UR (crypto-psbt) all decode today. This hook
    // stays so a future format can be flagged as recognized-but-unsupported
    // in the window between adding detection and shipping its decoder.
    void format;
    return null;
}
