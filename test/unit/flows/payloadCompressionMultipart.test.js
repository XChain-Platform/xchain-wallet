// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    fileCompressionFieldOf,
    inflateDeflateRaw,
    inflateGatedPlaintext,
    resolveGatedCompression,
} from '../../../packages/core/src/flows/payloadCompression.js';

describe('multipart FILE compression fields', () => {
    it('reads version 0 compression at index 10', () => {
        expect(fileCompressionFieldOf('FILE|0|a|b|c|d|e|f|g|h|1')).toBe('1');
    });

    it('reads version 1 manifest compression at index 13', () => {
        const action = 'FILE|1|hash|2|20|a|b|c|d|e|f|g|h|1';
        expect(fileCompressionFieldOf(action)).toBe('1');
    });

    it('returns empty for parts, other actions, and short strings', () => {
        expect(fileCompressionFieldOf('FILE|2|hash|0|bytes')).toBe('');
        expect(fileCompressionFieldOf('SEND|1|hash|2|20|a|b|c|d|e|f|g|h|1')).toBe('');
        expect(fileCompressionFieldOf('FILE|1|hash|2|20')).toBe('');
        expect(fileCompressionFieldOf(null)).toBe('');
    });
});

describe('multipart gated compression resolution', () => {
    it('reads a version 1 tx_data field', async () => {
        const txData = 'FILE|1|hash|2|20|a|b|c|d|e|f|g|h|1';
        const sdk = { getAction: async () => ({ tx_data: txData }) };
        await expect(resolveGatedCompression({ sdk, actionIndex: 9 })).resolves.toBe('1');
    });
});

describe('inflation output cap', () => {
    const original = Buffer.from('bounded multipart output '.repeat(40));
    const deflated = zlib.deflateRawSync(original);

    it('rejects output inside the ratio guard but beyond the reader cap', async () => {
        expect(original.length).toBeLessThanOrEqual(deflated.length * 150);
        const result = await inflateDeflateRaw(deflated, {
            maxOutputBytes: original.length - 1,
        });
        expect(result.error).toBe('RATIO_GUARD_TRIPPED');
        expect(result.storedForm).toBe(true);
        expect(Buffer.from(result.bytes).equals(deflated)).toBe(true);
    });

    it('passes the reader cap through gated inflation', async () => {
        const result = await inflateGatedPlaintext(deflated, '1', {
            maxOutputBytes: original.length - 1,
        });
        expect(result.error).toBe('RATIO_GUARD_TRIPPED');
        expect(result.storedForm).toBe(true);
        expect(Buffer.from(result.bytes).equals(deflated)).toBe(true);
    });
});

describe('invalid inflation output cap', () => {
    const original = Buffer.from('invalid cap');
    const deflated = zlib.deflateRawSync(original);

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'returns stored form for %s',
        async (maxOutputBytes) => {
            const result = await inflateDeflateRaw(deflated, { maxOutputBytes });
            expect(result.error).toBe('INVALID_OPTIONS');
            expect(result.storedForm).toBe(true);
            expect(Buffer.from(result.bytes).equals(deflated)).toBe(true);
        },
    );
});
