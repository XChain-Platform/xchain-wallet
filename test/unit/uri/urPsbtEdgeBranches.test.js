// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    cborUnwrapBytes,
    decodeBytewordsMinimal,
    parseUrFrame,
    UrError,
    UrPsbtDecoder,
} from '../../../packages/core/src/uri/urPsbt.js';

const here = dirname(fileURLToPath(import.meta.url));
const { vectors } = JSON.parse(
    readFileSync(join(here, 'fixtures', 'ur-vectors.json'), 'utf8'),
);
const ordered200 = vectors.find((vector) => vector.name === 'multi-ordered-200');
const ordered300 = vectors.find((vector) => vector.name === 'multi-ordered-300');

describe('UR PSBT edge branches', () => {
    it('reports initial state and rejects PSBT access before completion', () => {
        const decoder = new UrPsbtDecoder();

        expect(decoder.progress).toBe(0);
        expect(decoder.complete).toBe(false);
        expect(() => decoder.psbt).toThrow(/decode incomplete/);
        expect(() => decoder.psbtHex).toThrow(/decode incomplete/);
    });

    it('locks onto the first type when no expected type is configured', () => {
        const decoder = new UrPsbtDecoder({ expectType: '' });
        const bytesFrame = ordered200.parts[0].replace('ur:crypto-psbt/', 'ur:bytes/');

        expect(decoder.receive(bytesFrame)).toBe(true);
        const progress = decoder.progress;
        expect(decoder.receive(ordered200.parts[1])).toBe(false);
        expect(decoder.progress).toBe(progress);
    });

    it('rejects fountain parts whose metadata changes mid-stream', () => {
        const decoder = new UrPsbtDecoder();

        expect(decoder.receive(ordered200.parts[0])).toBe(true);
        const progress = decoder.progress;
        expect(decoder.receive(ordered300.parts[0])).toBe(false);
        expect(decoder.progress).toBe(progress);
    });

    it.each([
        ['non-string bytewords', null, /must be a string/],
        ['empty bytewords', '', /empty bytewords/],
        ['checksum-only short input', 'ae', /too short to carry a checksum/],
    ])('rejects bytewords: %s', (_label, input, message) => {
        expect(() => decodeBytewordsMinimal(input)).toThrow(message);
    });

    it.each([
        ['empty CBOR', [], /unexpected end/],
        ['truncated length', [0x58], /truncated integer/],
        ['truncated byte string', [0x58, 0x02, 0xaa], /truncated byte string/],
        ['indefinite item', [0x5f], /unsupported additional-info/],
        ['wrong major type', [0x61, 0x61], /unsupported major type/],
        ['array instead of bytes', [0x80], /expected a byte string/],
    ])('rejects CBOR: %s', (_label, bytes, message) => {
        expect(() => cborUnwrapBytes(Uint8Array.from(bytes))).toThrow(message);
    });

    it.each([
        ['invalid type token', 'ur:crypto_psbt/aeadaolazmjendeoti'],
        ['empty payload', 'ur:crypto-psbt/'],
        ['non-finite sequence number', `ur:crypto-psbt/${'9'.repeat(400)}-1/aeadaolazmjendeoti`],
    ])('rejects a frame with %s', (_label, frame) => {
        expect(() => parseUrFrame(frame)).toThrow(UrError);
    });

    it.skip('rejects extra UR path segments (bug: parseUrFrame ignores trailing path data)', () => {
        expect(() => parseUrFrame(`${ordered200.parts[0]}/ignored`)).toThrow(UrError);
    });
});
