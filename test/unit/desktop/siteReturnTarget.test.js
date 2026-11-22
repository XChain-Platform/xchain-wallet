/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { URI_MAX_LENGTH } from '@xchain-wallet/core/uri/bip21.js';

import { siteReturnTarget } from '../../../packages/desktop/main/siteRequest.js';

describe('desktop site browser return target', () => {
    it('keeps normal HTTPS returns unchanged', () => {
        const withResult = 'https://app.example/return?request=one#xchain=Abc_123-xyz';
        const withoutResult = 'https://app.example/return?request=one';

        expect(siteReturnTarget(withResult)).toBe(withResult);
        expect(siteReturnTarget(withoutResult)).toBe(withoutResult);
    });

    it('allows HTTP only for localhost under Developer Mode', () => {
        expect(siteReturnTarget('http://localhost:8080/')).toBeNull();
        expect(siteReturnTarget('http://localhost:8080/', { developerMode: true }))
            .toBe('http://localhost:8080/');
        expect(siteReturnTarget('http://example.com/', { developerMode: true })).toBeNull();
    });

    it('refuses non-HTTPS schemes, credentials and invalid input', () => {
        expect(siteReturnTarget('https://user:pass@app.example/return')).toBeNull();
        expect(siteReturnTarget('javascript:alert(1)')).toBeNull();
        expect(siteReturnTarget('file:///tmp/return.html')).toBeNull();
        expect(siteReturnTarget('')).toBeNull();
        expect(siteReturnTarget(42)).toBeNull();
    });

    it('accepts only the xchain base64url result fragment', () => {
        expect(siteReturnTarget('https://app.example/#other=x')).toBeNull();
        expect(siteReturnTarget('https://app.example/#xchain=')).toBeNull();
        expect(siteReturnTarget('https://app.example/#xchain=a+b')).toBeNull();
        expect(siteReturnTarget('https://app.example/#xchain=a/b')).toBeNull();
        expect(siteReturnTarget('https://app.example/#xchain=a=b')).toBeNull();
    });

    it('caps the target before its fragment at 2,048 characters', () => {
        const prefix = 'https://app.example/';
        const atLimit = `${prefix}${'a'.repeat(2_048 - prefix.length)}`;
        const overLimit = `${atLimit}a`;

        expect(siteReturnTarget(`${atLimit}#xchain=A`)).toBe(`${atLimit}#xchain=A`);
        expect(siteReturnTarget(`${overLimit}#xchain=A`)).toBeNull();
    });

    it('caps the whole URL at URI_MAX_LENGTH', () => {
        const prefix = 'https://app.example/#xchain=';
        const atLimit = `${prefix}${'a'.repeat(URI_MAX_LENGTH - prefix.length)}`;

        expect(atLimit).toHaveLength(URI_MAX_LENGTH);
        expect(siteReturnTarget(atLimit)).toBe(atLimit);
        expect(siteReturnTarget(`${atLimit}a`)).toBeNull();
    });

    it('honours a smaller injected whole-URL cap', () => {
        const target = 'https://app.example/#xchain=A';

        expect(siteReturnTarget(target, { maxLength: target.length })).toBe(target);
        expect(siteReturnTarget(target, { maxLength: target.length - 1 })).toBeNull();
    });
});
