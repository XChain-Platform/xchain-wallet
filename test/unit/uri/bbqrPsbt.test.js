// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { base32 } from '@scure/base';
import pako from 'pako';
import { describe, expect, it } from 'vitest';
import {
    BbqrError,
    decodeBbqrFrames,
    decodeBbqrPsbt,
    encodeBbqrPsbtFrames,
    parseBbqrFrame,
} from '../../../packages/core/src/uri/bbqrPsbt.js';

const PSBT_HEX = `70736274ff${'01020304'.repeat(30)}`;

const base36 = (value) => value.toString(36).toUpperCase().padStart(2, '0');

function base32Frames(hex, encoding, payloadLength) {
    const bytes = Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
    const payloadBytes = encoding === 'Z' ? pako.deflate(bytes) : bytes;
    const payload = base32.encode(payloadBytes).replace(/=+$/, '');
    const total = Math.ceil(payload.length / payloadLength);
    return Array.from({ length: total }, (_, index) => (
        `B$${encoding}P${base36(total)}${base36(index)}`
        + payload.slice(index * payloadLength, (index + 1) * payloadLength)
    ));
}

describe('BBQr PSBT transport', () => {
    it.each([
        ['hex string', PSBT_HEX],
        ['hex string with prefix', `0x${PSBT_HEX}`],
        ['bytes', Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 1, 2, 3])],
    ])('round-trips %s through H frames', (_label, input) => {
        const frames = encodeBbqrPsbtFrames(input, { payloadBytes: 16 });
        const decoded = decodeBbqrPsbt([...frames].reverse());
        const expected = typeof input === 'string'
            ? input.replace(/^0x/, '')
            : Array.from(input, (byte) => byte.toString(16).padStart(2, '0')).join('');

        expect(decoded.psbtHex).toBe(expected);
    });

    it('splits a large PSBT into multiple frames', () => {
        expect(encodeBbqrPsbtFrames(PSBT_HEX, { payloadBytes: 16 }).length).toBeGreaterThan(1);
    });

    it.each([
        ['B', 13],
        ['Z', 11],
    ])('decodes out-of-order %s base32 frames', (encoding, payloadLength) => {
        const frames = base32Frames(PSBT_HEX, encoding, payloadLength);

        expect(decodeBbqrPsbt([...frames].reverse()).psbtHex).toBe(PSBT_HEX);
    });

    it.each(['P', 'T', 'R', 'C', 'U', 'J', 'X'])('parses supported file type %s', (fileType) => {
        expect(parseBbqrFrame(`B$H${fileType}0100AA`)).toEqual({
            encoding: 'H',
            fileType,
            total: 1,
            index: 0,
            payload: 'AA',
        });
    });

    it('accepts identical duplicate frames but rejects conflicting duplicates', () => {
        const frames = encodeBbqrPsbtFrames(PSBT_HEX, { payloadBytes: 16 });

        expect(decodeBbqrPsbt([frames[0], ...frames]).psbtHex).toBe(PSBT_HEX);
        expect(() => decodeBbqrFrames([
            frames[0],
            `${frames[0].slice(0, -2)}AA`,
            ...frames.slice(1),
        ])).toThrow(/payload mismatch/);
    });

    it.each([
        ['non-string', null],
        ['short frame', 'B$HP010'],
        ['wrong prefix', 'BBHP0100AA'],
        ['unknown encoding', 'B$QP0100AA'],
        ['unknown file type', 'B$HY0100AA'],
        ['invalid base36 total', 'B$HP?100AA'],
        ['zero total', 'B$HP0000AA'],
        ['index equal to total', 'B$HP0101AA'],
    ])('rejects malformed frame: %s', (_label, frame) => {
        expect(() => parseBbqrFrame(frame)).toThrow(BbqrError);
    });

    it.each([
        ['empty frame set', []],
        ['missing frame', ['B$HP0200AA']],
        ['total mismatch', ['B$HP0200AA', 'B$HP0301BB']],
        ['encoding mismatch', ['B$HP0200AA', 'B$BP0201ME']],
        ['file type mismatch', ['B$HP0200AA', 'B$HT0201BB']],
        ['odd hex payload', ['B$HP0100A']],
        ['invalid base32 payload', ['B$BP0100A0']],
        ['invalid zlib payload', ['B$ZP0100AAAAAAAA']],
    ])('rejects malformed frame set: %s', (_label, frames) => {
        expect(() => decodeBbqrFrames(frames)).toThrow(BbqrError);
    });

    it('rejects non-PSBT file types in the PSBT convenience decoder', () => {
        expect(() => decodeBbqrPsbt(['B$HT0100DEADBEEF'])).toThrow(/expected PSBT/);
    });

    it.each([
        ['empty string', ''],
        ['empty bytes', new Uint8Array()],
        ['odd hex', 'abc'],
        ['non-hex string', 'not-hex'],
        ['unsupported input', {}],
    ])('rejects malformed PSBT input: %s', (_label, input) => {
        expect(() => encodeBbqrPsbtFrames(input)).toThrow(BbqrError);
    });

    it.each([0, -1, 1.5, '10'])('rejects invalid payloadBytes %s', (payloadBytes) => {
        expect(() => encodeBbqrPsbtFrames(PSBT_HEX, { payloadBytes })).toThrow(/positive integer/);
    });
});
