// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    format,
    getFormatLocale,
} from '../../packages/core/src/i18n/index.js';

const I18N_MODULE = '../../packages/core/src/i18n/index.js';
const PSEUDO_RTL_MODULE = '../../packages/core/src/i18n/locales/pseudo-rtl/index.js';

afterEach(() => {
    vi.doUnmock(PSEUDO_RTL_MODULE);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
});

async function importWithPseudoRtlMock(factory) {
    vi.resetModules();
    vi.doMock(PSEUDO_RTL_MODULE, factory);
    return import(I18N_MODULE);
}

describe('remaining i18n branches', () => {
    it('loads a namespace-shaped lazy locale module', async () => {
        const i18n = await importWithPseudoRtlMock(() => ({
            default: {
                default: { 'common.back': 'Namespace back' },
            },
        }));

        await expect(i18n.setLocale('pseudo-rtl')).resolves.toBe('pseudo-rtl');
        expect(i18n.t('common.back')).toBe('Namespace back');
    });

    it('keeps the active locale when a lazy locale fails to load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const i18n = await importWithPseudoRtlMock(() => {
            throw new Error('chunk load failed');
        });

        await expect(i18n.setLocale('pseudo-rtl')).resolves.toBe('en');
        expect(warn).toHaveBeenCalledWith(
            'setLocale: failed to load "pseudo-rtl"; keeping "en"',
            expect.any(Error),
        );
    });

    it('handles a lazy-load failure when console is unavailable', async () => {
        const i18n = await importWithPseudoRtlMock(() => {
            throw new Error('chunk load failed');
        });
        vi.stubGlobal('console', undefined);

        await expect(i18n.setLocale('pseudo-rtl')).resolves.toBe('en');
    });

    it('walks rich-text children and preserves multiple missing arguments', () => {
        expect(format(
            '<strong>{first} {second}</strong>',
            { strong: (parts) => parts.join('') },
        )).toBe('{first} {second}');
    });

    it('bounds locale and message-format caches', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        for (let index = 1_000; index < 1_110; index += 1) {
            expect(getFormatLocale(index)).toBe('en');
        }
        for (let index = 0; index <= 500; index += 1) {
            expect(format(`cache ${index}: {value}`, { value: index }))
                .toBe(`cache ${index}: ${index}`);
        }

        expect(warn).toHaveBeenCalled();
    });

    it('resolves invalid locales without requiring console', () => {
        vi.stubGlobal('console', undefined);

        expect(getFormatLocale(987_654_321)).toBe('en');
    });

    it('covers malformed legacy plural case boundaries', () => {
        expect(format('{count, plural, =0 {none}}', { count: 0 })).toBe('none');
        expect(format('{count, plural, one {one}   }', { count: 1 })).toBe('one');
        expect(format('{count, plural, broken}', { count: 1 })).toBe('');
    });

    it('falls back to cardinal categories when plural rules throw', () => {
        vi.spyOn(Intl, 'PluralRules').mockImplementation(() => {
            throw new Error('plural rules unavailable');
        });

        expect(format('{count, plural, one {one}}', { count: 1 })).toBe('one');
        expect(format('{count, plural, other {other}}', { count: 2 })).toBe('other');
    });
});
