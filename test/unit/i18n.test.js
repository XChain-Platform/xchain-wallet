// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getLocale,
    onLocaleChange,
    registerLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';

const traverse = _traverse.default || _traverse;
const TEST_LOCALE = 'unit-partial';
const TRANSLATION_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const sharedSources = import.meta.glob(
    '../../packages/core/src/shared/**/*.{js,jsx}',
    { query: '?raw', import: 'default', eager: true },
);

function translationUsage(source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    let importsT = false;
    const keys = new Set();

    traverse(ast, {
        ImportDeclaration(path) {
            if (!path.node.source.value.endsWith('/i18n/index.js')) return;
            importsT = path.node.specifiers.some((specifier) => (
                specifier.type === 'ImportSpecifier' && specifier.imported.name === 't'
            ));
        },
        StringLiteral(path) {
            if (TRANSLATION_KEY.test(path.node.value)) keys.add(path.node.value);
        },
        TemplateLiteral(path) {
            if (path.node.expressions.length !== 0) return;
            const value = path.node.quasis[0]?.value.cooked;
            if (value && TRANSLATION_KEY.test(value)) keys.add(value);
        },
    });

    return { importsT, keys: importsT ? keys : new Set() };
}

function missingTranslationKeys(keys, dictionary) {
    return [...keys].filter((key) => typeof dictionary[key] !== 'string').sort();
}

beforeEach(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

afterAll(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

describe('translations', () => {
    it('looks up English keys and exposes unknown keys', () => {
        expect(t('common.back')).toBe('Back');
        expect(t('missing.unit.key')).toBe('missing.unit.key');
    });

    it('falls back to English when the active locale omits a key', async () => {
        registerLocale(TEST_LOCALE, { 'common.back': 'Retour' });
        await setLocale(TEST_LOCALE);

        expect(t('common.back')).toBe('Retour');
        expect(t('session.unlock')).toBe('Unlock');
    });

    it('stamps root language metadata when the selected locale is already active', async () => {
        document.documentElement.removeAttribute('dir');
        document.documentElement.lang = 'stale';
        const subscriber = vi.fn();
        const unsubscribe = onLocaleChange(subscriber);

        await setLocale('en');

        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
        expect(subscriber).not.toHaveBeenCalled();
        unsubscribe();
    });

    it('interpolates message variables', () => {
        expect(t('home.balanceUnavailable', { reason: 'offline' }))
            .toBe('Balance unavailable: offline');
    });

    it('selects singular and plural forms', () => {
        expect(t('home.addressCount', { count: 1 })).toBe('1 address');
        expect(t('home.addressCount', { count: 2 })).toBe('2 addresses');
    });

    it('finds table-driven translation keys', () => {
        const source = `
            import { t } from '../../i18n/index.js';
            const COPY = { ready: 'status.ready', failed: \`status.failed\` };
            t(COPY.ready);
        `;

        const { keys } = translationUsage(source);

        expect([...keys].sort()).toEqual(['status.failed', 'status.ready']);
        expect(missingTranslationKeys(keys, { 'status.ready': 'Ready' }))
            .toEqual(['status.failed']);
    });

    it('defines every translation key used by shared code in English', () => {
        const translatedFiles = [];
        const usedKeys = new Set();

        for (const [file, source] of Object.entries(sharedSources)) {
            const usage = translationUsage(source);
            if (!usage.importsT) continue;
            translatedFiles.push(file);
            for (const key of usage.keys) usedKeys.add(key);
        }

        expect(translatedFiles).toEqual(expect.arrayContaining([
            '../../packages/core/src/shared/routes/History.jsx',
            '../../packages/core/src/shared/routes/ScanRoute.jsx',
            '../../packages/core/src/shared/routes/Send.jsx',
        ]));
        expect(usedKeys.size).toBeGreaterThan(0);
        expect(missingTranslationKeys(usedKeys, en)).toEqual([]);
    });
});
