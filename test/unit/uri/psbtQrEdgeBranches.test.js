// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    addChunkToCollector,
    createXcwCollector,
    crc32,
    decodeXcwChunks,
    encodeXcwChunks,
    XCW_MAX_FRAMES,
} from '../../../packages/core/src/uri/psbtQr.js';

function frameFor(content, n = 1, total = 1) {
    const crc = crc32(content).toString(16).padStart(8, '0');
    return `XCW:${n}/${total}:${crc}:${Buffer.from(content).toString('base64')}`;
}

describe('XCW PSBT QR edge branches', () => {
    it('accepts byte-wide typed arrays and rejects wider views', () => {
        const input = new Uint8ClampedArray([0x70, 0x73, 0x62, 0x74, 0xff]);

        expect(decodeXcwChunks(encodeXcwChunks(input, { chunkBytes: 64 })).psbtHex)
            .toBe('70736274ff');
        expect(() => encodeXcwChunks(new Uint16Array([0x7073]))).toThrow(/hex string or Uint8Array/);
    });

    it('rejects a chunk size that leaves no room after the hash', () => {
        expect(() => encodeXcwChunks('70736274ff', { chunkBytes: 32 }))
            .toThrow(/too small to hold the hash/);
    });

    it('rejects an input that would exceed the frame-count cap', () => {
        const bytes = new Uint8Array(1 + XCW_MAX_FRAMES * 33);

        expect(() => encodeXcwChunks(bytes, { chunkBytes: 33 }))
            .toThrow(new RegExp(`over the ${XCW_MAX_FRAMES}-frame cap`));
    });

    it('rejects chunk one when it cannot carry a complete hash', () => {
        const state = createXcwCollector();

        addChunkToCollector(state, frameFor(new Uint8Array(31)));

        expect(state.error).toBe('chunk 1 too short to hold SHA256 hash');
        expect(state.receivedCount).toBe(0);
    });

    it('leaves an errored collector terminal', () => {
        const state = createXcwCollector();
        const [valid] = encodeXcwChunks('70736274ff', { chunkBytes: 64 });

        addChunkToCollector(state, 'not a frame');
        const error = state.error;
        addChunkToCollector(state, valid);

        expect(state.error).toBe(error);
        expect(state.receivedCount).toBe(0);
    });

    it('leaves a completed collector terminal', () => {
        const state = createXcwCollector();
        const [valid] = encodeXcwChunks('70736274ff', { chunkBytes: 64 });

        addChunkToCollector(state, valid);
        addChunkToCollector(state, 'not a frame');

        expect(state.complete).toBe(true);
        expect(state.error).toBeNull();
        expect(state.receivedCount).toBe(1);
    });
});
