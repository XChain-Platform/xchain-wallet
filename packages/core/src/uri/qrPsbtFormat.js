// QR PSBT format detector — §20.4 / G043.
//
// A scanner can receive PSBT frames in any of three formats today:
//
//   • XCW    — the wallet's own chunked transport (`XCW:n/total:crc:b64`)
//   • BBQr   — Sparrow / Coldcard / SeedSigner standard
//              (`B$EFNNXX<payload>`)
//   • UR     — Foundation Passport / Keystone CBOR-bytewords format
//              (`ur:crypto-psbt/...`); fountain-coded multi-part variant
//              not yet supported
//
// `detectQrFrameFormat(frame)` returns the format name (or null when
// the frame matches none of the known prefixes). Callers dispatch on
// the answer, route the frame to the right collector, and surface a
// clear "format X is not yet supported by this wallet" error for
// formats with no decoder yet (currently UR — BBQr H/B/Z all decode
// as of Cluster U FOLLOWUP 1; UR remains tracked as Cluster U FU 2).

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
    if (format === 'ur') {
        return 'UR (Foundation / Keystone CBOR-bytewords) PSBT QR — recognized but not yet supported by this wallet. Use BBQr or XCW from your other wallet, or paste the PSBT hex directly.';
    }
    return null;
}
