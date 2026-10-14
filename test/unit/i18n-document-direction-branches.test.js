// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getDirection,
    syncDocumentLocale,
} from '../../packages/core/src/i18n/index.js';

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
});

describe('i18n document direction branches', () => {
    it.each([
        ['AR-eg', 'rtl'],
        ['he', 'rtl'],
        ['pseudo-rtl', 'rtl'],
        ['en-GB', 'ltr'],
        ['not-a-locale', 'ltr'],
    ])('classifies %s as %s', (locale, direction) => {
        expect(getDirection(locale)).toBe(direction);
    });

    it('advertises pseudo-RTL as English while retaining RTL direction', () => {
        syncDocumentLocale('pseudo-rtl');

        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('rtl');
    });

    it('uses a real locale for both language and direction metadata', () => {
        syncDocumentLocale('ar-EG');

        expect(document.documentElement.lang).toBe('ar-EG');
        expect(document.documentElement.dir).toBe('rtl');
    });

    it('does nothing when no document is available', () => {
        vi.stubGlobal('document', undefined);

        expect(() => syncDocumentLocale('ar')).not.toThrow();
    });
});
