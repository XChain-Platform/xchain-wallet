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
import { multipartFailureMessage } from '../../../packages/core/src/shared/utils/multipartFailureMessage.js';

const CASES = [
    ['MULTIPART_NOT_ACTIVE', false],
    ['FILE_FUNDING_NOT_CONFIRMED', true],
    ['FILE_PIECE_NOT_INDEXED', true],
    ['FILE_MULTIPART_PENDING_TIMEOUT', true],
    ['FILE_MULTIPART_MISMATCH', false],
    ['FUNDING_OUTPUT_SPENT', false],
    ['RESUME_ORIGINAL_MISMATCH', false],
    ['RESUME_PLAN_MISMATCH', false],
    ['RESUME_SOURCE_MISMATCH', false],
    ['GATED_RESUME_KEY_MISMATCH', false],
    ['GATED_PACK_KEY_MISSING', false],
    ['GATED_PACK_KEY_HASH_MISMATCH', false],
    ['FILE_UPLOAD_NOT_FOUND', false],
];

describe('multipartFailureMessage mappings', () => {
    it.each(CASES)('maps %s with resumable=%s', (code, resumable) => {
        expect(multipartFailureMessage({ code })).toEqual({
            code,
            message: expect.any(String),
            resumable,
        });
    });

    it('marks only saved uploads as resumable', () => {
        const resumableCodes = CASES
            .filter(([code]) => multipartFailureMessage({ code }).resumable)
            .map(([code]) => code);
        expect(resumableCodes).toEqual([
            'FILE_FUNDING_NOT_CONFIRMED',
            'FILE_PIECE_NOT_INDEXED',
            'FILE_MULTIPART_PENDING_TIMEOUT',
        ]);
    });
});

describe('multipartFailureMessage transport shapes', () => {
    it('maps an in-process Error and a hydrated Error identically', () => {
        const direct = new Error('Multi-part upload is still pending.');
        direct.code = 'FILE_MULTIPART_PENDING_TIMEOUT';
        const serialized = { name: direct.name, message: direct.message, code: direct.code };
        const hydrated = Object.assign(new Error(serialized.message), serialized);
        expect(multipartFailureMessage(hydrated)).toEqual(multipartFailureMessage(direct));
    });

    it('reads no error field other than code', () => {
        const err = {
            code: 'FILE_UPLOAD_NOT_FOUND',
            get name() { throw new Error('name was read'); },
            get message() { throw new Error('message was read'); },
        };
        expect(multipartFailureMessage(err)?.code).toBe('FILE_UPLOAD_NOT_FOUND');
    });
});

describe('multipartFailureMessage fallthrough', () => {
    it.each([
        { code: 'SOME_OTHER_FAILURE' },
        null,
        'FILE_UPLOAD_NOT_FOUND',
        {},
    ])('returns null for an unmapped input', (value) => {
        expect(multipartFailureMessage(value)).toBeNull();
    });
});

describe('multipartFailureMessage copy safety', () => {
    it.each(CASES)('keeps the %s message free of developer wording', (code) => {
        const { message } = multipartFailureMessage({ code });
        expect(message).toMatch(/\.$/);
        expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
        expect(message).not.toMatch(/\d+ ?ms\b/);
        const sentenceCount = message.split(/(?<=[.!?])\s+/).length;
        expect(message).not.toContain('\u2014');
        expect(sentenceCount).toBeGreaterThanOrEqual(1);
        expect(sentenceCount).toBeLessThanOrEqual(2);
    });
});

describe('multipartFailureMessage input integrity', () => {
    it('does not mutate its input', () => {
        const input = Object.freeze({
            name: 'Error',
            message: 'Multi-part upload 123 is still pending after 900000ms.',
            code: 'FILE_MULTIPART_PENDING_TIMEOUT',
        });
        const before = { ...input };
        multipartFailureMessage(input);
        expect(input).toEqual(before);
    });
});
