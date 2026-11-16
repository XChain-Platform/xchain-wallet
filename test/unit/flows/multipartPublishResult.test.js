// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { multipartPublishResult } from '../../../packages/core/src/flows/multipartPublishResult.js';
import { storedSizeLine, storedSizeSummary } from '../../../packages/core/src/flows/storedSizeSummary.js';

const TXID = 'ab'.repeat(32);

function reply(overrides = {}) {
    const { multipart = {}, upload = {}, ...rest } = overrides;
    return {
        pendingFileUploadId: 'upload-1',
        fileId: '42',
        txid: TXID,
        multipart: {
            status: 'complete',
            total_parts: 2,
            total_bytes: 400,
            ...multipart,
        },
        quote: { total: 1234 },
        upload: { gated: false, id: 'upload-1', ...upload },
        ...rest,
    };
}

function capture(run) {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('Expected function to throw');
}

describe('multipart publish result public compression report', () => {
    it.each([
        ['compressed', 1000, 400, true],
        ['uncompressed', 400, 400, false],
    ])('reports a %s public file', (_name, originalBytes, totalBytes, compressed) => {
        const result = multipartPublishResult(
            reply({ multipart: { total_bytes: totalBytes } }), { originalBytes },
        );
        const summary = storedSizeSummary(result.compression);
        expect(result.compression).toEqual({ rawLength: originalBytes, storedLength: totalBytes, compressed });
        expect(summary.compressed).toBe(compressed);
        expect(storedSizeLine(summary)).not.toBeNull();
    });
});

describe('multipart publish result gated compression report', () => {
    it('returns null for a gated file', () => {
        const result = multipartPublishResult(reply({ upload: { gated: true } }), { originalBytes: 300 });
        expect(result.compression).toBeNull();
    });
});

describe('multipart publish result transaction count', () => {
    it('maps 26 parts to 55 transactions', () => {
        const input = reply({ multipart: { total_parts: 26 } });
        expect(multipartPublishResult(input, { originalBytes: 500 }).transactions).toBe(55);
    });
});

describe('multipart publish result manifest identity', () => {
    it.each([[42], ['42']])('normalizes fileId %j to a decimal string', (fileId) => {
        const result = multipartPublishResult(reply({ fileId }), { originalBytes: 500 });
        expect(result).toMatchObject({ actionIndex: '42', txid: TXID });
    });
});

describe('multipart publish result validation', () => {
    it.each([
        ['multipart.status', { multipart: { status: 'pending' } }, 500],
        ['fileId', { fileId: 0 }, 500],
        ['fileId', { fileId: '01' }, 500],
        ['txid', { txid: 'AB'.repeat(32) }, 500],
        ['multipart.total_parts', { multipart: { total_parts: 1 } }, 500],
        ['multipart.total_parts', { multipart: { total_parts: 33 } }, 500],
        ['multipart.total_parts', { multipart: { total_parts: 2.5 } }, 500],
        ['multipart.total_bytes', { multipart: { total_bytes: 0 } }, 500],
        ['multipart.total_bytes', { multipart: { total_bytes: 12_000_001 } }, 500],
        ['multipart.total_bytes', { multipart: { total_bytes: 1.5 } }, 500],
        ['originalBytes', {}, 0],
        ['originalBytes', {}, 1.5],
    ])('rejects invalid %s', (field, overrides, originalBytes) => {
        const error = capture(() => multipartPublishResult(reply(overrides), { originalBytes }));
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: 'MULTIPART_RESULT_INVALID' });
        expect(error.message).toContain(field);
    });
});

describe('multipart publish result input ownership', () => {
    it('does not mutate the reply', () => {
        const input = reply();
        const before = structuredClone(input);
        multipartPublishResult(input, { originalBytes: 500 });
        expect(input).toEqual(before);
    });
});
