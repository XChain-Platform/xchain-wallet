// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §54 FOLLOWUP 5: lazy locale loading. This runs under Vitest (Vite),
// so `import.meta.glob` resolves to a real code-split importer map and
// the lazy path is exercised end-to-end (unlike the Node smoke, which
// registers pseudo-rtl by hand because plain Node has no import.meta.glob).

import { beforeEach, describe, expect, test } from 'vitest';

import {
    availableLocales,
    getDirection,
    getLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';

beforeEach(async () => {
    // Reset to a known baseline; en is always statically registered.
    if (getLocale() !== 'en') await setLocale('en');
});

describe('lazy locale loading', () => {
    test('availableLocales() surfaces lazily-discoverable codes', () => {
        const codes = availableLocales();
        expect(codes).toContain('en');
        // pseudo-rtl exists only as a chunk on disk, never statically
        // imported: its presence proves import.meta.glob enumeration.
        expect(codes).toContain('pseudo-rtl');
    });

    test('setLocale() lazily loads an un-registered locale, then applies it', async () => {
        // pseudo-rtl copy is bracket-wrapped, so a wrapped result proves
        // the chunk was fetched and swapped into the live dictionary.
        const before = t('common.back');
        expect(before).toBe('Back');

        const applied = await setLocale('pseudo-rtl');
        expect(applied).toBe('pseudo-rtl');
        expect(getLocale()).toBe('pseudo-rtl');

        const after = t('common.back');
        expect(after.startsWith('‏⟦')).toBe(true);
        expect(after.endsWith('⟧')).toBe(true);

        // Direction flips through the jsdom document.
        expect(getDirection()).toBe('rtl');
        expect(document.documentElement.dir).toBe('rtl');
    });

    test('switching back to en restores copy and direction', async () => {
        await setLocale('pseudo-rtl');
        await setLocale('en');
        expect(t('common.back')).toBe('Back');
        expect(getDirection()).toBe('ltr');
        expect(document.documentElement.dir).toBe('ltr');
    });

    test('an unknown, non-discoverable locale still throws synchronously', () => {
        expect(() => setLocale('zz-not-real')).toThrow(/unknown locale/);
    });
});
