// XCW chunked PSBT-over-QR transport — §20.3.
//
// Wire format per chunk:
//
//   XCW:<n>/<total>:<crc32-hex>:<base64-bytes>
//
//   • n, total       1-based integers; total is repeated in every
//                    chunk so a receiver scanning out-of-order can
//                    allocate the right number of slots up front.
//   • crc32-hex      lowercase 8-char hex of CRC32 over the decoded
//                    base64 bytes — per-chunk integrity, detects a
//                    flipped bit before it reaches the PSBT parser.
//   • base64-bytes   chunk content.
//
// Chunk-content layout:
//
//   chunk 1:         [32-byte SHA256 of full reassembled bytes]
//                    [payload-part-1 bytes]
//   chunks 2..N:     [payload-part-i bytes]
//
// The SHA256 lives on chunk 1 so the first-scanned chunk establishes
// the integrity target; subsequent chunks are validated against it
// after reassembly. (Putting the hash on every chunk would save a
// byte elsewhere but would mean we trust the LATEST-scanned hash —
// exactly the wrong property. See §20.3 spec: "overall reassembled
// PSBT is verified against an overall SHA256 hash included in chunk 1".)
//
// The reassembled bytes are the PSBT in its binary form. Callers who
// want hex can convert via `Buffer.from(psbtBytes).toString('hex')`
// or the browser equivalent. The decoder exports both forms.

import { sha256 } from '@noble/hashes/sha2';
import { base64ToBytes, bytesToBase64 } from '../crypto/kdf.js';

export const XCW_PREFIX = 'XCW:';
export const DEFAULT_CHUNK_BYTES = 180;  // base64(180) ≈ 240 chars; fits in alphanumeric QR ≤ 300 chars
const SHA256_LEN = 32;

const CHUNK_RE = /^XCW:(\d+)\/(\d+):([0-9a-f]{8}):(.+)$/;

export class XcwChunkError extends Error {
    constructor(msg) {
        super(`xcw-qr: ${msg}`);
        this.name = 'XcwChunkError';
    }
}

/**
 * @typedef {Object} EncodeOpts
 * @property {number} [chunkBytes]    payload bytes per chunk, pre-base64. Default {@link DEFAULT_CHUNK_BYTES}.
 */

/**
 * Chunk a PSBT for display as animated QR codes.
 *
 * @param {string | Uint8Array} psbt   hex string or raw bytes
 * @param {EncodeOpts} [opts]
 * @returns {string[]}                 one string per QR frame
 */
export function encodeXcwChunks(psbt, opts = {}) {
    const bytes = normalizePsbtInput(psbt);
    const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (!Number.isInteger(chunkBytes) || chunkBytes < 32) {
        throw new XcwChunkError('chunkBytes must be a positive integer ≥ 32');
    }
    if (bytes.length === 0) throw new XcwChunkError('empty PSBT');

    const hash = sha256(bytes);

    // Chunk 1 pays the 32-byte hash overhead; subsequent chunks use
    // their full budget. Split the payload so each chunk's content
    // fits inside chunkBytes.
    const firstPayloadCapacity = chunkBytes - SHA256_LEN;
    if (firstPayloadCapacity < 1) {
        throw new XcwChunkError('chunkBytes too small to hold the hash plus any payload');
    }

    const pieces = [];
    let offset = 0;
    // First chunk: up to firstPayloadCapacity bytes
    const first = bytes.subarray(offset, offset + firstPayloadCapacity);
    pieces.push(first);
    offset += first.length;
    // Remaining chunks: chunkBytes each
    while (offset < bytes.length) {
        const piece = bytes.subarray(offset, offset + chunkBytes);
        pieces.push(piece);
        offset += piece.length;
    }

    const total = pieces.length;
    /** @type {string[]} */
    const frames = [];
    for (let i = 0; i < total; i++) {
        const payload = pieces[i];
        const content =
            i === 0
                ? concatBytes(hash, payload)
                : payload;
        const crc = crc32(content).toString(16).padStart(8, '0');
        const b64 = bytesToBase64(content);
        frames.push(`${XCW_PREFIX}${i + 1}/${total}:${crc}:${b64}`);
    }
    return frames;
}

/**
 * Parse a single XCW chunk string. Validates shape + CRC but does not
 * check against the overall hash (which lives on chunk 1).
 *
 * @param {string} frame
 * @returns {{ n: number, total: number, content: Uint8Array }}
 */
export function parseXcwChunk(frame) {
    if (typeof frame !== 'string') throw new XcwChunkError('frame must be a string');
    const trimmed = frame.trim();
    const m = CHUNK_RE.exec(trimmed);
    if (!m) throw new XcwChunkError(`malformed frame: "${trimmed.slice(0, 40)}…"`);
    const n = Number.parseInt(m[1], 10);
    const total = Number.parseInt(m[2], 10);
    const crcHex = m[3];
    const b64 = m[4];
    if (!(n >= 1 && total >= 1 && n <= total)) {
        throw new XcwChunkError(`bad chunk index ${n}/${total}`);
    }
    let content;
    try {
        content = base64ToBytes(b64);
    } catch (e) {
        throw new XcwChunkError(`base64 decode failed: ${e?.message ?? e}`);
    }
    const actualCrc = crc32(content).toString(16).padStart(8, '0');
    if (actualCrc !== crcHex) {
        throw new XcwChunkError(`crc32 mismatch on chunk ${n}/${total} (expected ${crcHex}, got ${actualCrc})`);
    }
    return { n, total, content };
}

/**
 * @typedef {Object} XcwCollectorState
 * @property {number | null} total           null until the first chunk arrives
 * @property {(Uint8Array | null)[]} received
 * @property {number} receivedCount
 * @property {boolean} complete
 * @property {Uint8Array | null} expectedHash   pulled off chunk 1 when it arrives
 * @property {Uint8Array | null} psbt           non-null once complete AND hash verifies
 * @property {string | null} error
 */

/**
 * Progressive scanner state. Shell layer calls `addChunk` on every
 * successful QR scan; checks `state.complete` to know when to stop.
 *
 * @returns {XcwCollectorState}
 */
export function createXcwCollector() {
    return {
        total: null,
        received: [],
        receivedCount: 0,
        complete: false,
        expectedHash: null,
        psbt: null,
        error: null,
    };
}

/**
 * Feed a chunk into a collector. Returns the updated state (same
 * object for convenience — not a copy).
 *
 * @param {XcwCollectorState} state
 * @param {string} frame
 * @returns {XcwCollectorState}
 */
export function addChunkToCollector(state, frame) {
    if (state.complete) return state;
    /** @type {{ n: number, total: number, content: Uint8Array }} */
    let parsed;
    try {
        parsed = parseXcwChunk(frame);
    } catch (e) {
        state.error = e && e.message ? e.message : String(e);
        return state;
    }
    if (state.total === null) {
        state.total = parsed.total;
        state.received = Array.from({ length: parsed.total }, () => null);
    } else if (state.total !== parsed.total) {
        state.error = `total mismatch: saw ${parsed.total}, expected ${state.total}`;
        return state;
    }
    if (state.received[parsed.n - 1]) {
        // Duplicate scan (animated QR loops). Silently ignore.
        return state;
    }

    if (parsed.n === 1) {
        if (parsed.content.length < SHA256_LEN) {
            state.error = 'chunk 1 too short to hold SHA256 hash';
            return state;
        }
        state.expectedHash = parsed.content.subarray(0, SHA256_LEN);
        state.received[0] = parsed.content.subarray(SHA256_LEN);
    } else {
        state.received[parsed.n - 1] = parsed.content;
    }
    state.receivedCount += 1;

    if (state.receivedCount === state.total) {
        // All chunks in; reassemble + verify
        let totalLen = 0;
        for (const p of state.received) totalLen += p ? p.length : 0;
        const out = new Uint8Array(totalLen);
        let off = 0;
        for (const p of state.received) {
            if (p) {
                out.set(p, off);
                off += p.length;
            }
        }
        const hash = sha256(out);
        if (!state.expectedHash || !bytesEqual(hash, state.expectedHash)) {
            state.error = 'SHA256 of reassembled PSBT does not match hash from chunk 1';
            return state;
        }
        state.psbt = out;
        state.complete = true;
    }
    return state;
}

/**
 * One-shot convenience: parse + assemble a complete set of chunks all
 * at once. Order-independent.
 *
 * @param {string[]} frames
 * @returns {{ psbt: Uint8Array, psbtHex: string }}
 */
export function decodeXcwChunks(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new XcwChunkError('frames must be a non-empty array');
    }
    const state = createXcwCollector();
    for (const frame of frames) {
        addChunkToCollector(state, frame);
        if (state.error) throw new XcwChunkError(state.error);
    }
    if (!state.complete || !state.psbt) {
        throw new XcwChunkError(
            `incomplete: received ${state.receivedCount} of ${state.total ?? '?'} chunks`,
        );
    }
    return { psbt: state.psbt, psbtHex: bytesToHex(state.psbt) };
}

// Internal utilities

function normalizePsbtInput(psbt) {
    if (psbt instanceof Uint8Array) return psbt;
    if (typeof psbt !== 'string') {
        throw new XcwChunkError('psbt must be a hex string or Uint8Array');
    }
    const clean = psbt.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
        throw new XcwChunkError('psbt hex must be even-length lowercase hex');
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

function bytesToHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}

function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// CRC32 — classic IEEE polynomial, table-driven. Kept inline to avoid
// a dependency for such a small surface.
const CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
    }
    return t;
})();

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
