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
    parseXcwChunk,
} from '../../../packages/core/src/uri/psbtQr.js';

function frameFor(content, n = 1, total = 1) {
    const crc = crc32(content).toString(16).padStart(8, '0');
    return `XCW:${n}/${total}:${crc}:${Buffer.from(content).toString('base64')}`;
}

describe('XCW PSBT QR low-coverage branches', () => {
    it('rejects a repeated first chunk with the same hash and different payload', () => {
        const [frame] = encodeXcwChunks('01'.repeat(80), { chunkBytes: 48 });
        const original = parseXcwChunk(frame);
        const shorter = original.content.subarray(0, original.content.length - 1);
        const state = createXcwCollector();

        addChunkToCollector(state, frame);
        addChunkToCollector(state, frameFor(shorter, 1, original.total));

        expect(state.error).toBe('conflicting content for chunk 1');
    });

    it('rejects a repeated first chunk when collector hash state is absent', () => {
        const [frame] = encodeXcwChunks('70736274ff', { chunkBytes: 64 });
        const state = createXcwCollector();
        state.total = 1;
        state.received = [Uint8Array.of(1)];

        addChunkToCollector(state, frame);

        expect(state.error).toBe('conflicting content for chunk 1');
    });

    it('handles a sparse defensive collector state without counting null slots', () => {
        const state = createXcwCollector();
        state.total = 2;
        state.received = [null, null];
        state.receivedCount = 1;
        state.expectedHash = new Uint8Array(32);

        addChunkToCollector(state, frameFor(Uint8Array.of(1), 2, 2));

        expect(state.error).toMatch(/SHA256/);
        expect(state.complete).toBe(false);
    });

    it('promotes collector parse errors through the one-shot decoder', () => {
        expect(() => decodeXcwChunks(['not a frame'])).toThrow(/malformed frame/);
    });
});
