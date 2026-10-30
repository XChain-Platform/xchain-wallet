// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The `zlib` browser shim, held to Node's own inflateRawSync.
//
// The SDK's carrier verifier calls `zlib.inflateRawSync(carried,
// { maxOutputLength })` and compares the result with `.equals(expected)`,
// treating any throw as a payload mismatch. So the shim must return a Buffer
// with the exact bytes Node would, refuse output past the cap, and refuse a
// stream Node would refuse, or a tampered push could pass in the browser
// shells while failing in Node (and the reverse, which is the label publish
// regression this shim closes).
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import shimDefault, { inflateRawSync } from '../../../packages/core/src/shims/zlib-browser.js';

// A hex payload like the encrypted label batch the encoder compresses.
const PAYLOAD = Buffer.from(
    Array.from({ length: 1032 }, (_, i) => ((i * 37) % 251).toString(16).padStart(2, '0')).join(''),
    'binary',
);
const DEFLATED = zlib.deflateRawSync(PAYLOAD);

describe('zlib browser shim', () => {
    it('exposes inflateRawSync on the default export a CJS consumer receives', () => {
        expect(typeof shimDefault.inflateRawSync).toBe('function');
        expect(shimDefault.inflateRawSync).toBe(inflateRawSync);
    });

    it('inflates to the same bytes as Node, as a Buffer the verifier can compare', () => {
        const out = inflateRawSync(DEFLATED, { maxOutputLength: PAYLOAD.length });
        expect(Buffer.isBuffer(out)).toBe(true);
        expect(out.equals(PAYLOAD)).toBe(true);
        expect(out.equals(zlib.inflateRawSync(DEFLATED))).toBe(true);
    });

    it('inflates with no cap given', () => {
        expect(inflateRawSync(DEFLATED).equals(PAYLOAD)).toBe(true);
    });

    it('throws past maxOutputLength, as Node does', () => {
        const cap = PAYLOAD.length - 1;
        expect(() => zlib.inflateRawSync(DEFLATED, { maxOutputLength: cap })).toThrow(RangeError);
        expect(() => inflateRawSync(DEFLATED, { maxOutputLength: cap })).toThrow(RangeError);
    });

    it('throws on a truncated stream instead of returning a prefix', () => {
        const truncated = DEFLATED.subarray(0, DEFLATED.length - 4);
        expect(() => zlib.inflateRawSync(truncated)).toThrow();
        expect(() => inflateRawSync(truncated)).toThrow(/unexpected end of file/);
    });

    it('treats bytes after the end marker the way Node does', () => {
        const trailing = Buffer.concat([DEFLATED, Buffer.from([1, 2, 3])]);
        const outcome = (fn) => {
            try { return fn(trailing).equals(PAYLOAD) ? 'equal' : 'different'; } catch { return 'threw'; }
        };
        expect(outcome(inflateRawSync)).toBe(outcome((b) => zlib.inflateRawSync(b)));
    });

    it('throws on bytes that are not a deflate stream', () => {
        const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        expect(() => zlib.inflateRawSync(garbage)).toThrow();
        expect(() => inflateRawSync(garbage)).toThrow();
    });
});
