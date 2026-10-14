// Copyright (c) 2025-2026 Dankest, LLC
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

describe('BBQr edge branches', () => {
    it('falls back to raw DEFLATE for nonstandard Z frames', () => {
        const bytes = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 1, 2, 3]);
        const payload = base32.encode(pako.deflateRaw(bytes)).replace(/=+$/, '');

        expect(decodeBbqrPsbt([`B$ZP0100${payload}`]).psbtHex).toBe('70736274ff010203');
    });

    it('accepts the maximum frame count and rejects one more', () => {
        const maximum = encodeBbqrPsbtFrames(new Uint8Array(1295).fill(1), {
            payloadBytes: 1,
        });

        expect(maximum).toHaveLength(1295);
        expect(parseBbqrFrame(maximum.at(-1))).toMatchObject({ total: 1295, index: 1294 });
        expect(() => encodeBbqrPsbtFrames(new Uint8Array(1296), { payloadBytes: 1 }))
            .toThrow(/BBQr max is 1295/);
    });

    it('parses lowercase base36 digits and trims surrounding whitespace', () => {
        expect(parseBbqrFrame('  B$HP0a09AA  ')).toEqual({
            encoding: 'H',
            fileType: 'P',
            total: 10,
            index: 9,
            payload: 'AA',
        });
    });

    it('wraps structurally invalid base32 and rejects non-array frame input', () => {
        expect(() => decodeBbqrFrames(['B$BP0100A'])).toThrow(BbqrError);
        expect(() => decodeBbqrFrames('B$HP0100AA')).toThrow(/non-empty array/);
    });
});
