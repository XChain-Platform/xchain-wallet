// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFormatLocale } from '../../packages/core/src/i18n/index.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('i18n format locale resolution branches', () => {
    it('keeps structurally valid locale tags unchanged', () => {
        expect(getFormatLocale('en-US')).toBe('en-US');
        expect(getFormatLocale('zz')).toBe('zz');
    });

    it('uses a supported base language for an invalid compound tag', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(getFormatLocale('en-foo')).toBe('en');
        expect(warn).toHaveBeenCalledWith(
            'i18n: locale "en-foo" is not a tag Intl accepts; formatting as "en"',
        );
    });

    it('uses English when an invalid tag has no supported base language', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(getFormatLocale('zz-foo')).toBe('en');
        expect(warn).toHaveBeenCalledWith(
            'i18n: locale "zz-foo" is not a tag Intl accepts; formatting as "en"',
        );
    });

    it('coerces non-string locale inputs before resolving them', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(getFormatLocale(7)).toBe('en');
        expect(warn).toHaveBeenCalledWith(
            'i18n: locale "7" is not a tag Intl accepts; formatting as "en"',
        );
    });
});
