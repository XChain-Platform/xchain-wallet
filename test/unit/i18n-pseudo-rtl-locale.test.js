// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    registerLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';
import pseudoRtl from '../../packages/core/src/i18n/locales/pseudo-rtl/index.js';

afterEach(async () => {
    await setLocale('en');
    vi.restoreAllMocks();
});

describe('pseudo-RTL locale', () => {
    it('wraps every English value without changing the key set', () => {
        expect(Object.keys(pseudoRtl)).toEqual(Object.keys(en));

        for (const [key, value] of Object.entries(en)) {
            expect(pseudoRtl[key]).toBe(`‏⟦${value}⟧`);
        }
    });

    it('retains ICU placeholders for interpolation', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerLocale('pseudo-rtl', pseudoRtl);
        await setLocale('pseudo-rtl');

        expect(t('pending.detail.firstSeen', { when: 'just now' }))
            .toBe('‏⟦First seen by the network just now⟧');
        expect(t('history.row.confirmations', { count: 2 }))
            .toBe('‏⟦2 Confirmations⟧');
    });
});
