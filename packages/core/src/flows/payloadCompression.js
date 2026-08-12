/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************
 *
 * Client-side FILE payload inflation (spec Part B), wallet side.
 *
 * The wallet only needs this for TOKEN-GATED files. For a public FILE the
 * explorer already inflates on serve, so anything fetched through the raw
 * endpoint arrives as original bytes. Gated bytes are different by design
 * (spec §5.4): COMPRESSION=1 on a gated FILE means inflate AFTER decrypt,
 * client-side only, because the serving layer holds no key and must never
 * inflate ciphertext.
 *
 * Implemented on DecompressionStream('deflate-raw'), which every current
 * browser and Node 22 provide natively. That is precisely why deflate-raw
 * was chosen over zstd (spec §5.3): zero added dependency in every wallet
 * build (web, extension service worker, Electron renderer), where Node's
 * zlib is unavailable.
 *
 * FAIL-CLOSED (spec §5.5): COMPRESSION is sender-asserted and unverified. On
 * an invalid stream or a tripped ratio guard the caller receives the DECRYPTED
 * bytes as stored-form plus an explicit error, never partial output, and never
 * an exception.
 *
 ********************************************************************/

/** Vendored byte-identical from xchain-documentation/protocol/constants.js. */
export const COMPRESSION_CODE_DEFLATE_RAW = '1';
export const COMPRESSION_MAX_RATIO = 150;

/**
 * FILE v0 field indices in the FULL action string (ACTION token included):
 * FILE|0|NAME|TYPE|TITLE|MEMO|GATE_TICKER|ENCRYPTION_METHOD|KEY_HASH|GATE_MIN_AMOUNT|COMPRESSION
 */
export const COMPRESSION_FIELD_INDEX = 10;

/**
 * Read the COMPRESSION field out of a FILE v0 action string.
 * Anything that is not a FILE v0, or is too short, reads as '' (raw).
 *
 * @param {string} actionString
 * @returns {string} the field verbatim, or ''.
 */
export function compressionFieldOf(actionString) {
    if (typeof actionString !== 'string' || actionString.length === 0) return '';
    const parts = actionString.split('|');
    if (parts.length <= COMPRESSION_FIELD_INDEX) return '';
    if (String(parts[0]).toUpperCase() !== 'FILE') return '';
    if (String(parts[1]) !== '0') return '';
    return String(parts[COMPRESSION_FIELD_INDEX]);
}

/**
 * Does this declared value mean deflate-raw?
 *
 * Strict equality against the known code, so any unknown or future value
 * degrades to "do not inflate" rather than erroring. That degradation is the
 * whole compatibility story: an old wallet meeting a future codec shows the
 * stored bytes instead of crashing.
 *
 * @param {string | boolean | null | undefined} declared
 * @returns {boolean}
 */
export function declaresDeflateRaw(declared) {
    if (declared === true) return true;
    return typeof declared === 'string' && declared === COMPRESSION_CODE_DEFLATE_RAW;
}

/**
 * Inflate deflate-raw bytes with a streamed ratio guard. Never throws.
 *
 * The guard aborts mid-stream rather than measuring a finished buffer: a
 * compression bomb must stop being read once it exceeds the ceiling, not after
 * it has been fully allocated in a renderer process.
 *
 * @param {Uint8Array} stored
 * @param {{ maxRatio?: number }} [options]
 * @returns {Promise<{bytes: Uint8Array, inflated: boolean, storedForm: boolean,
 *                    error: string|null, storedLength: number, originalLength: number}>}
 */
export async function inflateDeflateRaw(stored, options = {}) {
    const maxRatio = options.maxRatio === undefined ? COMPRESSION_MAX_RATIO : options.maxRatio;

    const asStored = (input, error) => ({
        bytes: input,
        inflated: false,
        storedForm: true,
        error,
        storedLength: input ? input.length : 0,
        originalLength: input ? input.length : 0,
    });

    if (!stored || typeof stored.length !== 'number') return asStored(new Uint8Array(0), 'INVALID_INPUT');
    const input = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
    if (input.length === 0) return asStored(input, 'EMPTY_STREAM');
    if (typeof DecompressionStream !== 'function') return asStored(input, 'NO_DECOMPRESSION_STREAM');
    if (typeof ReadableStream !== 'function') return asStored(input, 'NO_READABLE_STREAM');

    const ceiling = Math.max(1, Math.ceil(input.length * maxRatio));

    try {
        // Feed the bytes through a ReadableStream rather than Blob.stream():
        // Blob.prototype.stream is absent in some hosts (jsdom, older embedded
        // webviews), and falling back there would silently disable inflation
        // for every gated file instead of failing visibly.
        const source = new ReadableStream({
            start(controller) {
                controller.enqueue(input);
                controller.close();
            },
        });
        const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
        const reader = stream.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > ceiling) {
                // Streamed abort: stop pulling, drop what we have.
                try { await reader.cancel(); } catch { /* already closing */ }
                chunks.length = 0;
                return asStored(input, 'RATIO_GUARD_TRIPPED');
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return {
            bytes,
            inflated: true,
            storedForm: false,
            error: null,
            storedLength: input.length,
            originalLength: bytes.length,
        };
    } catch {
        // Truncated, corrupt, or simply-not-deflate bytes (a lying field).
        return asStored(input, 'INVALID_DEFLATE_STREAM');
    }
}

/**
 * Apply the gated inflate-after-decrypt step (spec §5.4).
 *
 * @param {Uint8Array} decrypted - plaintext straight out of AES-256-GCM.
 * @param {string | boolean | null | undefined} declared - the FILE's
 *   COMPRESSION field.
 * @param {{ maxRatio?: number }} [options]
 * @returns {Promise<{bytes: Uint8Array, inflated: boolean, storedForm: boolean, error: string|null}>}
 */
export async function inflateGatedPlaintext(decrypted, declared, options = {}) {
    const bytes = decrypted instanceof Uint8Array ? decrypted : new Uint8Array(decrypted || []);
    if (!declaresDeflateRaw(declared))
        return { bytes, inflated: false, storedForm: false, error: null };

    const result = await inflateDeflateRaw(bytes, options);
    return {
        bytes: result.bytes,
        inflated: result.inflated,
        storedForm: result.storedForm,
        error: result.error,
    };
}

/**
 * Best-effort resolution of a gated FILE's COMPRESSION field.
 *
 * Order matters:
 *  1. an explicitly supplied value always wins (the caller decoded the action
 *     and knows; no round trip);
 *  2. otherwise probe the action record, reading the FULL action string when
 *     the explorer exposes one (spec §5.1 prefers the stored string over a
 *     parsed column) and falling back to a parsed COMPRESSION field;
 *  3. otherwise '' (raw). Unknown means do-not-inflate, never guess.
 *
 * Never throws: a probe failure degrades to '' so an unlock still returns the
 * decrypted bytes.
 *
 * NOTE: only ever called for an action index that definitely exists (we are
 * unlocking a published file), so it cannot poison the explorer's not-found
 * cache the way a speculative index probe would.
 *
 * @param {{ sdk: any, actionIndex: string|number, declared?: string|null }} params
 * @returns {Promise<string>}
 */
export async function resolveGatedCompression({ sdk, actionIndex, declared = null }) {
    if (typeof declared === 'string' && declared.length > 0) return declared;
    if (!sdk || typeof sdk.getAction !== 'function') return '';
    try {
        const action = await sdk.getAction(String(actionIndex));
        if (!action || typeof action !== 'object') return '';
        const record = action.data && typeof action.data === 'object' ? action.data : action;
        for (const key of ['action_string', 'actionString', 'raw_action']) {
            const candidate = record[key] ?? action[key];
            if (typeof candidate === 'string' && candidate.length > 0) {
                const field = compressionFieldOf(candidate);
                if (field.length > 0) return field;
            }
        }
        const parsed = record.COMPRESSION ?? record.compression;
        if (parsed !== undefined && parsed !== null) return String(parsed);
        return '';
    } catch {
        return '';
    }
}
