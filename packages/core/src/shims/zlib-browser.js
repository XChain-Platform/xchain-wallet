// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Browser-facing shim for Node's `zlib` module.
//
// xchain-sdk's carrier verifier (src/carrier/verify_carrier_scripts.js)
// proves a compressed rawData push on a P2SH/P2WSH chunk lane by calling
// `zlib.inflateRawSync(carried, { maxOutputLength })` and comparing the
// result to the bytes the user approved. The browser shells do not polyfill
// `zlib`, so the bundler hands the SDK an empty module; the call throws inside
// the verifier's try/catch and a correctly built transaction reads as
// PAYLOAD_MISMATCH. The confirm page then refuses every compressed chunk-lane
// action (a Bitcoin "Publish labels", a compressed FILE) before it opens.
//
// Only the synchronous raw inflate the verifier needs is provided, on pako
// (already a core dependency). It keeps Node's contract on the two points the
// verifier relies on: output past `maxOutputLength` throws instead of growing
// without bound, and a stream that never reaches its end marker throws
// instead of returning a prefix.

import pako from 'pako';
import { Buffer } from 'buffer';

/**
 * Inflate a raw DEFLATE stream synchronously.
 *
 * @param {Uint8Array} input
 * @param {{ maxOutputLength?: number }} [options]
 * @returns {Buffer}
 */
function inflateRawSync(input, options = {}) {
    const cap = Number.isFinite(options?.maxOutputLength) ? options.maxOutputLength : Infinity;
    const inflator = new pako.Inflate({ raw: true });
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    inflator.onData = (chunk) => {
        total += chunk.length;
        if (total > cap) {
            throw new RangeError(`Cannot create a Buffer larger than ${cap} bytes`);
        }
        chunks.push(Uint8Array.from(chunk));
    };
    // Not the final push: `ended` is then set only by a real end-of-stream
    // marker (or an error), which is how a truncated stream is told apart.
    inflator.push(input, false);
    if (inflator.err) throw new Error(inflator.msg || 'invalid deflate data');
    if (!inflator.ended) throw new Error('unexpected end of file');
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.length)), total);
}

export default { inflateRawSync };
export { inflateRawSync };
