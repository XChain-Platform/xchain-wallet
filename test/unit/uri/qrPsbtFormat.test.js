// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    describeUnsupportedFormat,
    detectQrFrameFormat,
} from '../../../packages/core/src/uri/qrPsbtFormat.js';

describe('QR PSBT format detection', () => {
    it.each([
        ['XCW:1/1:00000000:AA==', 'xcw'],
        ['  B$HP010070736274FF  ', 'bbqr'],
        ['ur:crypto-psbt/abcd', 'ur'],
        ['UR:CRYPTO-PSBT/ABCD', 'ur'],
    ])('detects %s as %s', (frame, format) => {
        expect(detectQrFrameFormat(frame)).toBe(format);
        expect(describeUnsupportedFormat(format)).toBeNull();
    });

    it.each([
        null,
        42,
        '',
        '   ',
        'XCW',
        'B$HP01',
        'not a frame',
    ])('rejects malformed or unknown frame %s', (frame) => {
        expect(detectQrFrameFormat(frame)).toBeNull();
    });
});
