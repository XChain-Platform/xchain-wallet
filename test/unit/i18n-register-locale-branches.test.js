// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import {
    registerLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';

afterEach(async () => {
    await setLocale('en');
});

describe('i18n locale registration branches', () => {
    it.each([[''], [null], [0]])('rejects invalid locale code %j', (locale) => {
        expect(() => registerLocale(locale, {}))
            .toThrow('registerLocale: locale must be a non-empty string');
    });

    it.each([[null], [undefined], ['copy'], [4]])('rejects invalid dictionary %j', (dictionary) => {
        expect(() => registerLocale('unit-invalid-dictionary', dictionary))
            .toThrow('registerLocale: dictionary must be an object');
    });

    it('replaces a registered dictionary and preserves English fallback', async () => {
        registerLocale('unit-replacement', { 'common.back': 'First' });
        await setLocale('unit-replacement');

        expect(t('common.back')).toBe('First');

        registerLocale('unit-replacement', { 'common.back': 'Second' });

        expect(t('common.back')).toBe('Second');
        expect(t('scan.title')).toBe('Scan');
    });
});
