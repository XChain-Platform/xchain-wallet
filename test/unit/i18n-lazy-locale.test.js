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

import { beforeEach, describe, expect, test, vi } from 'vitest';

let availableLocales;
let getDirection;
let getLocale;
let setLocale;
let t;

beforeEach(async () => {
    // Each case gets an unloaded locale registry so lazy-path assertions do
    // not depend on whether an earlier case has already cached the chunk.
    vi.resetModules();
    ({
        availableLocales,
        getDirection,
        getLocale,
        setLocale,
        t,
    } = await import('../../packages/core/src/i18n/index.js'));
});

describe('lazy locale loading', () => {
    test('availableLocales() surfaces lazily-discoverable codes', () => {
        const codes = availableLocales();
        expect(codes).toContain('en');
        // pseudo-rtl exists only as a chunk on disk, never statically
        // imported: its presence proves import.meta.glob enumeration.
        expect(codes).toContain('pseudo-rtl');
    });

    test('a completed lazy load cannot replace a newer locale choice', async () => {
        document.documentElement.dir = 'ltr';
        const pending = setLocale('pseudo-rtl');
        await setLocale('en');

        expect(await pending).toBe('en');
        expect(getLocale()).toBe('en');
        expect(t('common.back')).toBe('Back');
        expect(document.documentElement.dir).toBe('ltr');
    });

    test('setLocale() applies a lazily discovered locale', async () => {
        // pseudo-rtl copy is bracket-wrapped, so a wrapped result proves
        // the loaded dictionary is selected.
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

    test('a pick after a failed chunk load imports a fresh URL and applies the locale', async () => {
        const i18n = await import('../../packages/core/src/i18n/index.js');
        const chunkUrl = 'http://127.0.0.1:5860/src/i18n/locales/xx-retry/index.js';
        const dictionary = { 'common.back': 'Retour' };
        let calls = 0;
        // Rejects once then resolves, the way a network blip behaves.
        const loader = vi.fn(() => {
            calls += 1;
            if (calls === 1) {
                return Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${chunkUrl}`));
            }
            return Promise.resolve(dictionary);
        });
        const freshImport = vi.fn(async () => ({ default: dictionary }));
        i18n.__setLazyLocaleLoadersForTests({ './locales/xx-retry/index.js': loader }, freshImport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        document.documentElement.dir = 'ltr';

        expect(await i18n.setLocale('xx-retry')).toBe('en');
        expect(i18n.getLocale()).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');

        expect(await i18n.setLocale('xx-retry')).toBe('xx-retry');
        expect(i18n.getLocale()).toBe('xx-retry');
        expect(i18n.t('common.back')).toBe('Retour');
        // The browser replays a failed module URL, so the retry never goes
        // back through the same importer: it imports the chunk URL under a
        // fresh query.
        expect(loader).toHaveBeenCalledTimes(1);
        expect(freshImport).toHaveBeenCalledTimes(1);
        const retried = new URL(freshImport.mock.calls[0][0]);
        expect(`${retried.origin}${retried.pathname}`).toBe(chunkUrl);
        expect(retried.searchParams.get('locale-retry')).toBeTruthy();
        warn.mockRestore();
    });

    test('a chunk that keeps failing keeps English and each retry uses a new URL', async () => {
        const i18n = await import('../../packages/core/src/i18n/index.js');
        // A browser that cached the failure: the importer never resolves again.
        const loader = vi.fn(() => Promise.reject(new TypeError('Importing a module script failed.')));
        const seen = [];
        let online = false;
        const freshImport = vi.fn(async (url) => {
            seen.push(url);
            if (!online) throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
            return { default: { 'common.back': 'Zurück' } };
        });
        i18n.__setLazyLocaleLoadersForTests({ './locales/xx-sticky/index.js': loader }, freshImport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await i18n.setLocale('xx-sticky')).toBe('en');
        expect(await i18n.setLocale('xx-sticky')).toBe('en');
        online = true;
        expect(await i18n.setLocale('xx-sticky')).toBe('xx-sticky');
        expect(i18n.t('common.back')).toBe('Zurück');
        expect(loader).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(2);
        expect(seen[0]).not.toBe(seen[1]);
        // With no URL in the message, the glob path resolves against the
        // i18n module, and a retry URL never stacks a second retry query.
        for (const url of seen) {
            const parsed = new URL(url);
            expect(parsed.pathname.endsWith('/i18n/locales/xx-sticky/index.js')).toBe(true);
            expect(parsed.searchParams.getAll('locale-retry')).toHaveLength(1);
        }
        warn.mockRestore();
    });

    test('an unknown, non-discoverable locale still throws synchronously', () => {
        expect(() => setLocale('zz-not-real')).toThrow(/unknown locale/);
    });
});
