// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BBQr PSBT encode + decode (§20.4 / G043, partial).
//
// BBQr is the standard chunked-QR PSBT transport used by Sparrow,
// Coldcard, and SeedSigner. The frame format is:
//
//   B$<E><F><NN><XX><payload>
//
//   • B$       2-char magic prefix
//   • E        encoding char: H (hex) | B (base32) | Z (zlib + base32)
//   • F        file type: P (PSBT) | T (transaction) | R (binary) |
//                          C (CBOR) | U (UTF-8) | J (JSON) | X (executable)
//   • NN       2-char base36 (0-9A-Z): total frame count
//   • XX       2-char base36: frame index (0-based)
//   • payload  encoding-specific bytes (rest of the frame)
//
// Multi-frame reassembly: collect frames in order of `index`,
// concatenate payloads, decode the full bytestream once. BBQr does
// NOT carry per-chunk integrity (unlike XCW's CRC32); it relies on
// the QR code's own error correction.
//
// Coverage today:
//   ✅ H (hex): single + multi-frame, encode + decode
//   ✅ B (base32, RFC 4648 no padding): single + multi-frame decode
//   ✅ Z (zlib + base32): single + multi-frame decode (Cluster U FOLLOWUP 1)
//   ⏸ Multi-encoder fallback: N/A, user picks the encoder upstream
//
// Encode (Cluster W FOLLOWUP 4) emits H frames so a watcher-mode
// wallet's unsigned PSBT can be imported by Sparrow / Coldcard /
// SeedSigner. Hex is the simplest and least surprising choice; no
// dep on a base32 encoder, every BBQr-aware reader supports it.
// Coldcard / SeedSigner default to Z when sending PSBTs back to a
// host because Z compresses ~30%+ for typical PSBTs; the Z branch
// here lets users scan those replies straight into PsbtSignForm.

import { base32 } from '@scure/base';
// pako is CommonJS; destructure off the default import so the Node
// ESM loader is happy. Bundlers (Vite + Rollup) preserve the named
// references through tree-shaking.
import pako from 'pako';
const { inflate: pakoInflate, inflateRaw: pakoInflateRaw } = pako;

const BBQR_PREFIX = 'B$';
const BBQR_HEADER_LEN = 8;  // "B$EFNNXX"
const BBQR_BASE36_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class BbqrError extends Error {
    constructor(msg) {
        super(`bbqr: ${msg}`);
        this.name = 'BbqrError';
    }
}

const BBQR_ENCODINGS = /** @type {const} */ (['H', 'B', 'Z']);
const BBQR_FILE_TYPES = /** @type {const} */ (['P', 'T', 'R', 'C', 'U', 'J', 'X']);
const BBQR_FILE_TYPE_PSBT = 'P';

/**
 * @typedef {Object} BbqrFrame
 * @property {'H' | 'B' | 'Z'} encoding
 * @property {string} fileType   one of BBQR_FILE_TYPES
 * @property {number} total      total frame count (1..1295)
 * @property {number} index      0-based frame index
 * @property {string} payload    encoding-specific payload (rest of frame)
 */

// Default H-payload-bytes per frame. Each frame is "B$HP<NN><XX>" + 2
// hex chars per byte, so 200 payload bytes → 400 hex chars + 8-char
// header = 408 chars. Comfortably below the ~480-char alphanumeric QR
// ceiling at error-correction level M for version 27, a size most
// hardware-wallet cameras and phone cameras can read reliably.
const DEFAULT_BBQR_PAYLOAD_BYTES = 200;
const BBQR_MAX_FRAMES = 1295;  // 36^2 - 1 because base36 NN goes 00..ZZ

/**
 * Encode a PSBT into BBQr H (hex) frames suitable for animated-QR
 * display. Reciprocal to {@link decodeBbqrPsbt}. Frames are emitted
 * in index order; callers feed them to AnimatedQrFrames or any
 * generic chunked-QR renderer.
 *
 * @param {string | Uint8Array} psbt   hex string or raw bytes
 * @param {{ payloadBytes?: number }} [opts]
 * @returns {string[]}                 one BBQr frame per QR
 */
export function encodeBbqrPsbtFrames(psbt, opts = {}) {
    const bytes = normalizePsbtBytes(psbt);
    if (bytes.length === 0) {
        throw new BbqrError('cannot encode an empty PSBT');
    }
    const payloadBytes = opts.payloadBytes ?? DEFAULT_BBQR_PAYLOAD_BYTES;
    if (!Number.isInteger(payloadBytes) || payloadBytes < 1) {
        throw new BbqrError('payloadBytes must be a positive integer');
    }
    const total = Math.ceil(bytes.length / payloadBytes);
    if (total > BBQR_MAX_FRAMES) {
        throw new BbqrError(
            `PSBT too large: would need ${total} frames, BBQr max is ${BBQR_MAX_FRAMES}`,
        );
    }
    /** @type {string[]} */
    const frames = [];
    for (let i = 0; i < total; i++) {
        const slice = bytes.subarray(i * payloadBytes, (i + 1) * payloadBytes);
        const totalStr = formatBase36(total);
        const indexStr = formatBase36(i);
        const hex = bytesToHexUpper(slice);
        frames.push(`${BBQR_PREFIX}H${BBQR_FILE_TYPE_PSBT}${totalStr}${indexStr}${hex}`);
    }
    return frames;
}

/**
 * @param {string} frame
 * @returns {BbqrFrame}
 */
export function parseBbqrFrame(frame) {
    if (typeof frame !== 'string') {
        throw new BbqrError('frame must be a string');
    }
    const trimmed = frame.trim();
    if (trimmed.length < BBQR_HEADER_LEN) {
        throw new BbqrError(`frame too short (${trimmed.length} < ${BBQR_HEADER_LEN})`);
    }
    if (!trimmed.startsWith(BBQR_PREFIX)) {
        throw new BbqrError(`frame does not start with magic prefix "${BBQR_PREFIX}"`);
    }
    const encoding = trimmed[2];
    const fileType = trimmed[3];
    const totalStr = trimmed.slice(4, 6);
    const indexStr = trimmed.slice(6, 8);
    const payload = trimmed.slice(BBQR_HEADER_LEN);

    if (!BBQR_ENCODINGS.includes(encoding)) {
        throw new BbqrError(`unsupported encoding char "${encoding}"`);
    }
    if (!BBQR_FILE_TYPES.includes(fileType)) {
        throw new BbqrError(`unsupported file type char "${fileType}"`);
    }
    const total = parseBase36(totalStr);
    const index = parseBase36(indexStr);
    if (total < 1 || total > 1295) {
        throw new BbqrError(`bad total ${total}`);
    }
    if (index < 0 || index >= total) {
        throw new BbqrError(`bad index ${index} (0-based, must be < total ${total})`);
    }
    return { encoding, fileType, total, index, payload };
}

/**
 * Decode an array of BBQr frames into raw bytes. Frames may arrive
 * in any order; duplicates are tolerated. Encoding must match across
 * frames (the spec says all frames in a transmission share an
 * encoding). Returns the decoded payload as Uint8Array.
 *
 * @param {string[]} frames
 * @returns {{ bytes: Uint8Array, fileType: string, encoding: 'H' | 'B' | 'Z' }}
 */
export function decodeBbqrFrames(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new BbqrError('frames must be a non-empty array');
    }
    let total = null;
    let encoding = null;
    let fileType = null;
    /** @type {(string | null)[]} */
    const slots = [];
    for (const raw of frames) {
        const parsed = parseBbqrFrame(raw);
        if (total === null) {
            total = parsed.total;
            slots.length = parsed.total;
            slots.fill(null);
            encoding = parsed.encoding;
            fileType = parsed.fileType;
        } else {
            if (parsed.total !== total) {
                throw new BbqrError(`total mismatch: saw ${parsed.total}, expected ${total}`);
            }
            if (parsed.encoding !== encoding) {
                throw new BbqrError(`encoding mismatch: saw "${parsed.encoding}", expected "${encoding}"`);
            }
            if (parsed.fileType !== fileType) {
                throw new BbqrError(`fileType mismatch: saw "${parsed.fileType}", expected "${fileType}"`);
            }
        }
        if (slots[parsed.index] != null && slots[parsed.index] !== parsed.payload) {
            throw new BbqrError(`payload mismatch on duplicate index ${parsed.index}`);
        }
        slots[parsed.index] = parsed.payload;
    }
    for (let i = 0; i < slots.length; i++) {
        if (slots[i] == null) {
            throw new BbqrError(`missing frame index ${i} (have ${slots.filter(Boolean).length} of ${total})`);
        }
    }
    const joined = slots.join('');
    let bytes;
    if (encoding === 'H') {
        bytes = decodeHexUpper(joined);
    } else if (encoding === 'B') {
        bytes = decodeBase32NoPad(joined);
    } else if (encoding === 'Z') {
        // Z = zlib(deflate) over base32. The base32 decode is the same
        // alphabet as 'B', so re-use the helper; pako.inflate then
        // unwraps the zlib container (2-byte header + adler32 trailer).
        // BBQr-Z producers (Coldcard, SeedSigner) emit a standard
        // zlib stream; no raw-deflate fallback needed for spec'd
        // content. We do try inflateRaw on the standard-decode failure
        // path to be defensive, since some signers have shipped
        // raw-deflate-by-mistake frames in the wild.
        const compressed = decodeBase32NoPad(joined);
        bytes = inflateZlib(compressed);
    } else {
        throw new BbqrError(`unsupported encoding "${encoding}"`);
    }
    return { bytes, fileType, encoding };
}

/**
 * Convenience: decode and return both bytes and hex form. Asserts the
 * file type is `P` (PSBT) so a caller scanning a non-PSBT BBQr stream
 * (e.g., a transaction or a JSON dump) gets a clear error rather
 * than silently treating arbitrary bytes as a PSBT.
 *
 * @param {string[]} frames
 * @returns {{ psbt: Uint8Array, psbtHex: string }}
 */
export function decodeBbqrPsbt(frames) {
    const { bytes, fileType } = decodeBbqrFrames(frames);
    if (fileType !== BBQR_FILE_TYPE_PSBT) {
        throw new BbqrError(`expected PSBT (file type P), got "${fileType}"`);
    }
    return { psbt: bytes, psbtHex: bytesToHex(bytes) };
}

// --- Internal helpers -------------------------------------------------------

function parseBase36(s) {
    if (typeof s !== 'string' || s.length !== 2) {
        throw new BbqrError(`base36 input must be exactly 2 chars, got "${s}"`);
    }
    let n = 0;
    for (const ch of s) {
        const idx = BBQR_BASE36_ALPHABET.indexOf(ch.toUpperCase());
        if (idx < 0) {
            throw new BbqrError(`bad base36 char "${ch}" (alphabet 0-9A-Z)`);
        }
        n = n * 36 + idx;
    }
    return n;
}

function decodeHexUpper(s) {
    const clean = s.toUpperCase();
    if (!/^[0-9A-F]*$/.test(clean) || clean.length % 2 !== 0) {
        throw new BbqrError('hex payload must be even-length 0-9A-F');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

/**
 * Inflate a zlib-wrapped DEFLATE stream. Tries the standard zlib path
 * first (the spec'd shape); falls back to raw-deflate if the header
 * is missing. A defensive branch for signers that ship raw-deflate
 * by mistake.
 * @param {Uint8Array} compressed
 * @returns {Uint8Array}
 */
function inflateZlib(compressed) {
    try {
        return pakoInflate(compressed);
    } catch (e) {
        try {
            return pakoInflateRaw(compressed);
        } catch (_e2) {
            throw new BbqrError(`zlib inflate failed: ${e?.message ?? e}`);
        }
    }
}

function decodeBase32NoPad(s) {
    // BBQr's base32 is RFC 4648 with NO padding. @scure/base's `base32`
    // requires padding to a multiple of 8 chars. Pad with '=' before
    // delegating; @scure rejects malformed alphabets so an invalid
    // payload still gets caught.
    const clean = s.toUpperCase();
    if (!/^[A-Z2-7]*$/.test(clean)) {
        throw new BbqrError('base32 payload must be A-Z and 2-7 only');
    }
    const padLen = (8 - (clean.length % 8)) % 8;
    const padded = clean + '='.repeat(padLen);
    try {
        return base32.decode(padded);
    } catch (e) {
        throw new BbqrError(`base32 decode failed: ${e?.message ?? e}`);
    }
}

function bytesToHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}

function bytesToHexUpper(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).toUpperCase().padStart(2, '0');
    return s;
}

function normalizePsbtBytes(psbt) {
    if (psbt instanceof Uint8Array) return psbt;
    if (typeof psbt !== 'string') {
        throw new BbqrError('psbt must be a hex string or Uint8Array');
    }
    const clean = psbt.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
        throw new BbqrError('psbt hex must be even-length 0-9a-f');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

function formatBase36(n) {
    if (!Number.isInteger(n) || n < 0 || n > BBQR_MAX_FRAMES) {
        throw new BbqrError(`base36 input out of range: ${n}`);
    }
    const a = BBQR_BASE36_ALPHABET[Math.floor(n / 36) % 36];
    const b = BBQR_BASE36_ALPHABET[n % 36];
    return `${a}${b}`;
}
