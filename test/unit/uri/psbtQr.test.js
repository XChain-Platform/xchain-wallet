// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    addChunkToCollector,
    createXcwCollector,
    crc32,
    decodeXcwChunks,
    encodeXcwChunks,
    parseXcwChunk,
    XCW_MAX_FRAME_CHARS,
    XCW_MAX_FRAMES,
    XcwChunkError,
} from '../../../packages/core/src/uri/psbtQr.js';

const PSBT_HEX = `70736274ff${'01020304'.repeat(40)}`;

describe('XCW PSBT QR transport', () => {
    it.each([
        ['hex', PSBT_HEX],
        ['bytes', Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0, 1, 2])],
    ])('round-trips %s input across out-of-order frames', (_label, input) => {
        const frames = encodeXcwChunks(input, { chunkBytes: 48 });
        const decoded = decodeXcwChunks([...frames].reverse());
        const expected = typeof input === 'string'
            ? input
            : Array.from(input, (byte) => byte.toString(16).padStart(2, '0')).join('');

        expect(decoded.psbtHex).toBe(expected);
    });

    it('splits a large PSBT into multiple frames', () => {
        expect(encodeXcwChunks(PSBT_HEX, { chunkBytes: 48 }).length).toBeGreaterThan(1);
    });

    it('parses a frame and verifies the CRC32 checksum', () => {
        const [frame] = encodeXcwChunks('70736274ff', { chunkBytes: 64 });
        const parsed = parseXcwChunk(`  ${frame}  `);

        expect(parsed).toMatchObject({ n: 1, total: 1 });
        expect(crc32(parsed.content).toString(16).padStart(8, '0')).toBe(
            frame.split(':')[2],
        );
    });

    it('progressively collects out-of-order frames and ignores repeat scans', () => {
        const frames = encodeXcwChunks(PSBT_HEX, { chunkBytes: 48 });
        const state = createXcwCollector();

        addChunkToCollector(state, frames[1]);
        addChunkToCollector(state, frames[1]);
        expect(state.receivedCount).toBe(1);
        for (const frame of [frames[0], ...frames.slice(2)]) addChunkToCollector(state, frame);

        expect(state.error).toBeNull();
        expect(state.complete).toBe(true);
        expect(decodeXcwChunks(frames).psbtHex).toBe(PSBT_HEX);
    });

    it.each([
        ['non-array frame set', null, /non-empty array/],
        ['empty frame set', [], /non-empty array/],
        ['missing frame', () => encodeXcwChunks(PSBT_HEX, { chunkBytes: 48 }).slice(0, 1), /incomplete/],
    ])('rejects %s', (_label, value, message) => {
        const frames = typeof value === 'function' ? value() : value;
        expect(() => decodeXcwChunks(frames)).toThrow(message);
    });

    it.each([
        ['non-string frame', null],
        ['wrong prefix', 'QR:1/1:00000000:AA=='],
        ['zero index', 'XCW:0/1:00000000:AA=='],
        ['index above total', 'XCW:2/1:00000000:AA=='],
        ['uppercase CRC', 'XCW:1/1:DEADBEEF:AA=='],
        ['missing payload', 'XCW:1/1:00000000:'],
        ['invalid base64', 'XCW:1/1:00000000:%%%'],
        ['CRC mismatch', 'XCW:1/1:00000000:AA=='],
    ])('rejects malformed chunk: %s', (_label, frame) => {
        expect(() => parseXcwChunk(frame)).toThrow(XcwChunkError);
    });

    it.each([
        ['empty string', ''],
        ['empty bytes', new Uint8Array()],
        ['odd hex', 'abc'],
        ['non-hex string', 'not-hex'],
        ['unsupported input', {}],
    ])('rejects malformed PSBT input: %s', (_label, input) => {
        expect(() => encodeXcwChunks(input)).toThrow(XcwChunkError);
    });

    it.each([31, 0, -1, 32.5, '64'])('rejects invalid chunkBytes %s', (chunkBytes) => {
        expect(() => encodeXcwChunks(PSBT_HEX, { chunkBytes })).toThrow(/chunkBytes/);
    });

    it('reports mismatched frame totals without corrupting collected data', () => {
        const state = createXcwCollector();
        const [first] = encodeXcwChunks(PSBT_HEX, { chunkBytes: 48 });
        const [other] = encodeXcwChunks('70736274ff', { chunkBytes: 64 });

        addChunkToCollector(state, first);
        addChunkToCollector(state, other);

        expect(state.error).toMatch(/total mismatch/);
        expect(state.complete).toBe(false);
    });

    it('rejects a frame count before allocating collector slots', () => {
        const state = createXcwCollector();
        addChunkToCollector(state, `XCW:1/${XCW_MAX_FRAMES + 1}:00000000:AA==`);

        expect(state.error).toMatch(/frame count.*cap/);
        expect(state.total).toBeNull();
        expect(state.received).toEqual([]);
    });

    it('rejects an oversized frame before decoding its payload', () => {
        const oversized = `XCW:1/1:00000000:${'A'.repeat(XCW_MAX_FRAME_CHARS)}`;
        expect(() => parseXcwChunk(oversized)).toThrow(/frame is .* over the .* cap/);
    });

    it('does not encode frames that its parser must reject', () => {
        const bytes = new Uint8Array(XCW_MAX_FRAME_CHARS).fill(1);
        expect(() => encodeXcwChunks(bytes, { chunkBytes: XCW_MAX_FRAME_CHARS }))
            .toThrow(/encoded frame.*over the .* cap/);
    });

    it.each([0, 1])('rejects conflicting repeats of animated frame %i', (index) => {
        const firstSet = encodeXcwChunks(Uint8Array.from({ length: 160 }, () => 1), { chunkBytes: 48 });
        const otherSet = encodeXcwChunks(Uint8Array.from({ length: 160 }, () => 2), { chunkBytes: 48 });
        const state = createXcwCollector();

        addChunkToCollector(state, firstSet[index]);
        addChunkToCollector(state, otherSet[index]);
        for (const frame of firstSet) addChunkToCollector(state, frame);

        expect(state.error).toMatch(new RegExp(`conflicting content for chunk ${index + 1}`));
        expect(state.receivedCount).toBe(1);
        expect(state.complete).toBe(false);
    });

    it('rejects non-overlapping frames mixed from different animations', () => {
        const firstSet = encodeXcwChunks(Uint8Array.from({ length: 160 }, () => 1), { chunkBytes: 48 });
        const otherSet = encodeXcwChunks(Uint8Array.from({ length: 160 }, () => 2), { chunkBytes: 48 });
        const state = createXcwCollector();

        addChunkToCollector(state, firstSet[0]);
        for (const frame of otherSet.slice(1)) addChunkToCollector(state, frame);

        expect(state.error).toMatch(/SHA256.*does not match/);
        expect(state.complete).toBe(false);
    });
});
