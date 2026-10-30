// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    MAX_TOKEN_SUPPLY,
    issueImageUrlError,
    issueSupplyLimitError,
    issueTextLengthError,
} from '../../../packages/core/src/shared/utils/issueFieldValidation.js';

describe('issue field validation', () => {
    it('accepts the supply maximum and values beyond 2^63 without float rounding', () => {
        expect(issueSupplyLimitError('9223372036854775808')).toBeNull();
        expect(issueSupplyLimitError(MAX_TOKEN_SUPPLY)).toBeNull();
    });

    it('rejects the smallest divisible value above the supply maximum', () => {
        expect(issueSupplyLimitError(`${MAX_TOKEN_SUPPLY}.00000001`))
            .toBe('Supply cannot be more than 1,000,000,000,000,000,000,000.');
    });

    it('checks text length after trimming surrounding whitespace', () => {
        expect(issueTextLengthError('x'.repeat(249), 'Description')).toBeNull();
        expect(issueTextLengthError(`  ${'x'.repeat(250)}  `, 'Description'))
            .toBe('Description cannot be longer than 249 characters.');
    });

    it.each([
        'https://example.test/art.png',
        'http://example.test/art.png',
        'ipfs://bafybeigdyrzt/art.png',
        'ar:transaction-id',
    ])('accepts a renderable image URL: %s', (url) => {
        expect(issueImageUrlError(url)).toBeNull();
    });

    it.each([
        'javascript:alert(1)',
        'data:image/svg+xml,<svg></svg>',
        'file:///tmp/art.png',
        'not a url',
    ])('rejects a non-renderable image URL: %s', (url) => {
        expect(issueImageUrlError(url)).toBe('Image URL must use http, https, ipfs, or ar.');
    });
});
