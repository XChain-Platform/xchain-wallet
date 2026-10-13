// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    compiledPayloadByteLen,
    envelopeEncoderOpts,
    rawDataByteLen,
} from '../../../packages/core/src/flows/envelopeSelection.js';
import {
    MAX_COMPILED_ACTION_BYTES,
    pushPrefixSize,
} from '../../../packages/core/src/flows/fileSizeLimits.js';

const withPrefix = (n) => n + pushPrefixSize(n);

describe('compiledPayloadByteLen', () => {
    it('counts an ASCII action with no rawData as one prefixed push', () => {
        const action = 'SEND|JDOG|1|bcrt1qdest';
        expect(compiledPayloadByteLen(action)).toBe(withPrefix(action.length));
    });

    it('counts a multi-byte action in UTF-8 bytes, not characters', () => {
        const action = 'BROADCAST|café \u{1F600}';
        const utf8 = Buffer.byteLength(action, 'utf8');
        expect(utf8).toBeGreaterThan(action.length);
        expect(compiledPayloadByteLen(action)).toBe(withPrefix(utf8));
    });

    it('counts a null action as no action bytes', () => {
        expect(compiledPayloadByteLen(null)).toBe(withPrefix(0));
        expect(compiledPayloadByteLen(undefined, 'abc')).toBe(withPrefix(0) + withPrefix(3));
    });

    it('adds rawData as a second prefixed push', () => {
        const raw = 'x'.repeat(300);
        expect(compiledPayloadByteLen('FILE|a', raw)).toBe(withPrefix(6) + withPrefix(300));
    });

    it('treats an omitted compression report the same as a null one', () => {
        const raw = 'y'.repeat(500);
        expect(compiledPayloadByteLen('FILE|a', raw, null))
            .toBe(compiledPayloadByteLen('FILE|a', raw));
    });

    it('clamps rawData to a smaller reported stored length', () => {
        const raw = 'z'.repeat(1000);
        expect(compiledPayloadByteLen('FILE|a', raw, { compressed: true, storedLength: 200 }))
            .toBe(withPrefix(6) + withPrefix(200));
    });

    it('never widens rawData to a larger reported stored length', () => {
        const raw = 'z'.repeat(100);
        expect(compiledPayloadByteLen('FILE|a', raw, { compressed: true, storedLength: 5000 }))
            .toBe(withPrefix(6) + withPrefix(100));
    });

    it.each([
        ['an uncompressed report', { compressed: false, storedLength: 10 }],
        ['a report with no stored length', { compressed: true }],
        ['a negative stored length', { compressed: true, storedLength: -1 }],
        ['a non-numeric stored length', { compressed: true, storedLength: 'abc' }],
    ])('leaves rawData unclamped for %s', (_label, compression) => {
        const raw = 'z'.repeat(400);
        expect(compiledPayloadByteLen('FILE|a', raw, compression))
            .toBe(withPrefix(6) + withPrefix(400));
    });
});

describe('rawDataByteLen', () => {
    it('counts a string one byte per character, as the encoder reads it', () => {
        const raw = 'ÿ\u0080éabc';
        expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(raw.length);
        expect(rawDataByteLen(raw)).toBe(raw.length);
    });

    it('counts a byte array by its byteLength', () => {
        expect(rawDataByteLen(new Uint8Array(17))).toBe(17);
        expect(rawDataByteLen(Buffer.alloc(9))).toBe(9);
    });

    it('counts a missing payload as zero', () => {
        expect(rawDataByteLen(null)).toBe(0);
        expect(rawDataByteLen(undefined)).toBe(0);
    });
});

describe('envelope request at the compiled ceiling', () => {
    const descriptor = { addressTypes: ['p2wpkh', 'p2tr'] };
    const signer = { kind: 'software' };
    const encoderOpts = { pubkey: '02' + 'ab'.repeat(32) };

    // One OP_PUSHDATA2 push: three prefix bytes, so 8189 bytes sit exactly at 8192.
    const atLimit = 'A'.repeat(MAX_COMPILED_ACTION_BYTES - 3);
    const overLimit = `${atLimit}A`;

    it('sizes the boundary payloads one byte either side of the ceiling', () => {
        expect(compiledPayloadByteLen(atLimit)).toBe(MAX_COMPILED_ACTION_BYTES);
        expect(compiledPayloadByteLen(overLimit)).toBe(MAX_COMPILED_ACTION_BYTES + 1);
    });

    it('leaves a payload at the ceiling on the legacy carrier', () => {
        expect(envelopeEncoderOpts({
            descriptor, signer, encoderOpts, compiledBytes: compiledPayloadByteLen(atLimit),
        })).toBeNull();
    });

    it('asks for the envelope one byte over the ceiling', () => {
        expect(envelopeEncoderOpts({
            descriptor, signer, encoderOpts, compiledBytes: compiledPayloadByteLen(overLimit),
        })).toMatchObject({ encoding: 'AUTO', compressedPubKey: encoderOpts.pubkey });
    });
});
