// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: UR crypto-psbt decoder (§20.4 Cluster U FU 2).
//
// The fixtures in ur-vectors.json are GOLD-STANDARD vectors produced by the
// reference @ngraveio/bc-ur encoder (used only as an oracle, never shipped).
// They include single-part frames, ordered multi-part streams, and
// ALL-MIXED fountain streams (firstSeqNum = seqLen, so every transmitted
// part is an XOR mix that must be reduced). Reproducing these byte-for-byte
// proves interop with real Keystone / Foundation Passport output, not just
// internal round-trip consistency.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    decodeUrPsbt,
    UrPsbtDecoder,
    UrError,
    parseUrFrame,
    decodeBytewordsMinimal,
    cborUnwrapBytes,
    chooseFragments,
} from '../../../packages/core/src/uri/urPsbt.js';

const here = dirname(fileURLToPath(import.meta.url));
const { vectors, bwSamples } = JSON.parse(
    readFileSync(join(here, 'fixtures', 'ur-vectors.json'), 'utf8'),
);

const hexToBytes = (h) => {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
};
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('ur/bytewords (minimal)', () => {
    it('decodes minimal bytewords and verifies the trailing CRC32', () => {
        for (const s of bwSamples) {
            const decoded = decodeBytewordsMinimal(s.bytewords);
            expect(toHex(decoded)).toBe(s.cborHex);
            // and the CBOR layer unwraps to the raw payload
            expect(toHex(cborUnwrapBytes(decoded))).toBe(s.payloadHex);
        }
    });

    it('rejects a corrupted checksum', () => {
        const good = bwSamples[0].bytewords;
        // flip the last code to a different valid byteword to break the CRC
        const bad = good.slice(0, -2) + (good.endsWith('zo') ? 'ae' : 'zo');
        expect(() => decodeBytewordsMinimal(bad)).toThrow(UrError);
    });

    it('rejects odd-length and unknown bytewords', () => {
        expect(() => decodeBytewordsMinimal('abc')).toThrow(UrError);
        expect(() => decodeBytewordsMinimal('zz')).toThrow(UrError); // "zz" is not a minimal code
    });
});

describe('ur/decodeUrPsbt (gold vectors)', () => {
    for (const v of vectors) {
        it(`batch-decodes ${v.name} to the exact PSBT`, () => {
            const { psbtHex } = decodeUrPsbt(v.parts);
            expect(psbtHex).toBe(v.expectedHex);
        });
    }

    it('decodes every vector to bytes matching the expected payload', () => {
        for (const v of vectors) {
            const { psbt } = decodeUrPsbt(v.parts);
            expect(psbt).toEqual(hexToBytes(v.expectedHex));
        }
    });
});

describe('ur/UrPsbtDecoder (progressive, completion parity)', () => {
    for (const v of vectors) {
        it(`completes ${v.name} after the same parts as the reference`, () => {
            const dec = new UrPsbtDecoder();
            let completedAfter = -1;
            for (let i = 0; i < v.parts.length; i++) {
                dec.receive(v.parts[i]);
                if (dec.complete) {
                    completedAfter = i + 1;
                    break;
                }
            }
            expect(dec.complete).toBe(true);
            expect(completedAfter).toBe(v.refCompletedAfter);
            expect(dec.progress).toBe(1);
            expect(dec.psbtHex).toBe(v.expectedHex);
        });
    }

    it('reports fractional progress on a partial ordered stream', () => {
        const v = vectors.find((x) => x.kind === 'multi-ordered');
        const dec = new UrPsbtDecoder();
        dec.receive(v.parts[0]); // one pure fragment of seqLen
        expect(dec.complete).toBe(false);
        expect(dec.progress).toBeGreaterThan(0);
        expect(dec.progress).toBeLessThan(1);
    });

    it('ignores frames after completion and returns false', () => {
        const v = vectors.find((x) => x.kind === 'single');
        const dec = new UrPsbtDecoder();
        expect(dec.receive(v.parts[0])).toBe(true);
        expect(dec.receive(v.parts[0])).toBe(false);
    });
});

describe('ur/parseUrFrame', () => {
    it('parses a single-part frame', () => {
        const v = vectors.find((x) => x.kind === 'single');
        const f = parseUrFrame(v.parts[0]);
        expect(f.type).toBe('crypto-psbt');
        expect(f.isSinglePart).toBe(true);
        expect(f.seqNum).toBe(1);
        expect(f.seqLen).toBe(1);
    });

    it('parses a multi-part sequence header', () => {
        const v = vectors.find((x) => x.kind === 'multi-ordered');
        const f = parseUrFrame(v.parts[0]);
        expect(f.isSinglePart).toBe(false);
        expect(f.seqLen).toBe(v.seqLen);
        expect(f.seqNum).toBeGreaterThanOrEqual(1);
    });

    it('rejects non-ur and malformed frames', () => {
        expect(() => parseUrFrame('B$HP0100abcd')).toThrow(UrError);
        expect(() => parseUrFrame('ur:crypto-psbt')).toThrow(UrError); // no payload
        expect(() => parseUrFrame('ur:crypto-psbt/x-y/abcd')).toThrow(UrError); // bad seq
        expect(() => parseUrFrame(42)).toThrow(UrError);
    });
});

describe('ur/chooseFragments (fountain index selection)', () => {
    it('returns the single pure fragment for seqNum <= seqLen', () => {
        expect(chooseFragments(1, 5, 0x12345678)).toEqual([0]);
        expect(chooseFragments(5, 5, 0x12345678)).toEqual([4]);
    });

    it('returns a deterministic mix for seqNum > seqLen', () => {
        const a = chooseFragments(6, 5, 0x12345678);
        const b = chooseFragments(6, 5, 0x12345678);
        expect(a).toEqual(b); // deterministic
        expect(a.length).toBeGreaterThanOrEqual(1);
        expect(a.length).toBeLessThanOrEqual(5);
        for (const i of a) expect(i).toBeGreaterThanOrEqual(0);
    });
});

describe('ur/decodeUrPsbt (error paths)', () => {
    it('throws when frames are insufficient', () => {
        const v = vectors.find((x) => x.kind === 'multi-ordered');
        // only the first part: not enough to reassemble
        expect(() => decodeUrPsbt([v.parts[0]])).toThrow(UrError);
    });

    it('throws on an empty frame list', () => {
        expect(() => decodeUrPsbt([])).toThrow(UrError);
    });
});
