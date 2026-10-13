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
import { IntlMessageFormat } from 'intl-messageformat';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getFormatLocale,
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
const uriSources = import.meta.glob(
    '../../packages/core/src/uri/**/*.{js,jsx}',
    { query: '?raw', import: 'default', eager: true },
);
const packageSources = { ...sharedSources, ...uriSources };

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

function messageVariables(message) {
    const names = new Set();
    const visit = (elements) => {
        for (const element of elements) {
            if (element.type >= 1 && element.type <= 6) names.add(element.value);
            for (const option of Object.values(element.options ?? {})) visit(option.value);
            if (element.children) visit(element.children);
        }
    };
    visit(new IntlMessageFormat(message, 'en').getAst());
    return names;
}

function objectExpressionFor(node, scope) {
    if (node?.type === 'ObjectExpression') return { node, scope };
    if (node?.type !== 'Identifier') return null;
    const binding = scope.getBinding(node.name);
    if (binding?.path.node.type !== 'VariableDeclarator') return null;
    return objectExpressionFor(binding.path.node.init, binding.path.scope);
}

function propertyName(node, computed) {
    if (!computed && node?.type === 'Identifier') return node.name;
    if (node?.type === 'StringLiteral') return node.value;
    return null;
}

function keysFromExpression(node, scope, seen = new Set()) {
    if (!node) return new Set();
    if (node.type === 'StringLiteral') {
        return new Set(typeof en[node.value] === 'string' ? [node.value] : []);
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        const value = node.quasis[0]?.value.cooked;
        return new Set(typeof en[value] === 'string' ? [value] : []);
    }
    if (node.type === 'ConditionalExpression') {
        return new Set([
            ...keysFromExpression(node.consequent, scope, seen),
            ...keysFromExpression(node.alternate, scope, seen),
        ]);
    }
    if (node.type === 'LogicalExpression') {
        return new Set([
            ...keysFromExpression(node.left, scope, seen),
            ...keysFromExpression(node.right, scope, seen),
        ]);
    }
    if (node.type === 'Identifier') {
        const binding = scope.getBinding(node.name);
        if (!binding || seen.has(binding)) return new Set();
        seen.add(binding);
        if (binding.path.node.type !== 'VariableDeclarator') return new Set();
        return keysFromExpression(binding.path.node.init, binding.path.scope, seen);
    }
    if (node.type !== 'MemberExpression') return new Set();
    const resolved = objectExpressionFor(node.object, scope);
    if (!resolved) return new Set();
    const selectedName = propertyName(node.property, node.computed);
    const values = [];
    for (const property of resolved.node.properties) {
        if (property.type !== 'ObjectProperty') continue;
        const name = propertyName(property.key, property.computed);
        if (selectedName !== null && name !== selectedName) continue;
        values.push(...keysFromExpression(property.value, resolved.scope, seen));
    }
    return new Set(values);
}

function namesFromObjectExpression(node, scope, seen = new Set()) {
    if (!node) return null;
    if (node.type === 'ObjectExpression') {
        const names = new Set();
        for (const property of node.properties) {
            if (property.type === 'SpreadElement') {
                const spreadNames = namesFromObjectExpression(property.argument, scope, seen);
                if (spreadNames === null) return null;
                for (const name of spreadNames) names.add(name);
                continue;
            }
            if (property.type !== 'ObjectProperty') return null;
            const name = propertyName(property.key, property.computed);
            if (name === null) return null;
            names.add(name);
        }
        return names;
    }
    if (node.type !== 'Identifier') return null;
    const binding = scope.getBinding(node.name);
    if (!binding || seen.has(binding) || binding.path.node.type !== 'VariableDeclarator') return null;
    seen.add(binding);
    const names = namesFromObjectExpression(binding.path.node.init, binding.path.scope, seen);
    if (names === null) return null;
    for (const reference of binding.referencePaths) {
        const member = reference.parentPath;
        if (!member?.isMemberExpression() || member.node.object !== reference.node) continue;
        if (!member.parentPath?.isAssignmentExpression() || member.parentPath.node.left !== member.node) continue;
        const name = propertyName(member.node.property, member.node.computed);
        if (name !== null) names.add(name);
    }
    return names;
}

function placeholderCallViolations(file, source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const violations = [];
    let checkedCalls = 0;

    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.type !== 'Identifier' || path.node.callee.name !== 't') return;
            const keys = keysFromExpression(path.node.arguments[0], path.scope);
            for (const key of keys) {
                const required = messageVariables(en[key]);
                if (required.size === 0) continue;
                checkedCalls += 1;
                const supplied = namesFromObjectExpression(path.node.arguments[1], path.scope);
                const missing = supplied === null
                    ? [...required]
                    : [...required].filter((name) => !supplied.has(name));
                if (missing.length === 0) continue;
                const line = path.node.loc?.start.line ?? '?';
                violations.push(`${file}:${line} t('${key}') does not supply {${missing.join('}, {')}}`);
            }
        },
    });

    return { checkedCalls, violations };
}

function unbalancedBrace(message) {
    let depth = 0;
    for (let index = 0; index < message.length; index += 1) {
        if (message[index] === '{') depth += 1;
        if (message[index] !== '}') continue;
        depth -= 1;
        if (depth < 0) return index;
    }
    return depth === 0 ? null : message.length;
}

beforeEach(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

afterAll(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

describe('translations', () => {
    it('keeps English copy platform-neutral and typographically consistent', () => {
        const values = Object.values(en);

        expect(values.filter((value) => /\.\.\.| {2,}|\bclick\b/i.test(value))).toEqual([]);
        expect(values.filter((value) => (
            /\b(cannot|does not|do not|will not|could not|has not|is not|are not|it is)\b/i.test(value)
        ))).toEqual([]);
        const narrativeValues = Object.entries(en)
            .filter(([key]) => (
                (/(?:Body|Hint|Help)$|\.error\./.test(key))
                && key !== 'history.filters.fiatHelp'
            ))
            .map(([, value]) => value);
        expect(narrativeValues.filter((value) => !/[.!?…]$/.test(value))).toEqual([]);
        expect(en['send.memoCount']).toBe('{used, number} / {max, number} {used, plural, one {byte} other {bytes}}');
        expect(en['send.destination.placeholder']).toBe('Enter or paste an address or name…');
    });

    it('looks up English keys and exposes unknown keys', () => {
        expect(t('scan.title')).toBe('Scan');
        expect(t('missing.unit.key')).toBe('missing.unit.key');
    });

    it('falls back to English when the active locale omits a key', async () => {
        registerLocale(TEST_LOCALE, { 'common.back': 'Retour' });
        await setLocale(TEST_LOCALE);

        expect(t('common.back')).toBe('Retour');
        expect(t('scan.title')).toBe('Scan');
    });

    it('formats localized plurals with their source dictionary rules', async () => {
        registerLocale('ru', {
            'test.addressCount': [
                '{count, plural, one {# address} few {# addresses-few}',
                'many {# addresses-many} other {# addresses-other}}',
            ].join(' '),
        });
        await setLocale('ru');

        expect(t('test.addressCount', { count: 2 })).toBe('2 addresses-few');
        expect(t('history.recipients.saved', { count: 21, name: 'Ada' }))
            .toBe('Saved 21 addresses as a single contact "Ada".');
    });

    it('bounds cached locale resolutions', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const anchor = 'unit cache anchor';

        expect(getFormatLocale(anchor)).toBe('en');
        expect(getFormatLocale(anchor)).toBe('en');
        expect(warn).toHaveBeenCalledTimes(1);

        for (let i = 0; i <= 100; i += 1) {
            expect(getFormatLocale(`unit cache filler ${i}`)).toBe('en');
        }
        expect(getFormatLocale(anchor)).toBe('en');
        expect(warn).toHaveBeenCalledTimes(103);

        warn.mockRestore();
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
        expect(t('pending.detail.firstSeen', { when: 'just now' }))
            .toBe('First seen by the network just now');
    });

    it('reports a translation call that omits a required placeholder', () => {
        const source = `
            const t = () => {};
            t('send.networkFeeValue', { amount: '0.1' });
        `;

        expect(placeholderCallViolations('fixture.js', source).violations)
            .toEqual(["fixture.js:3 t('send.networkFeeValue') does not supply {ticker}"]);
    });

    it('supplies every English placeholder at every statically keyed t() call', () => {
        const violations = [];
        let checkedCalls = 0;

        for (const [file, source] of Object.entries(packageSources)) {
            if (!/\bt\s*\(/.test(source)) continue;
            const result = placeholderCallViolations(file, source);
            checkedCalls += result.checkedCalls;
            violations.push(...result.violations);
        }

        expect(checkedCalls).toBeGreaterThan(50);
        expect(violations).toEqual([]);
    });

    it('keeps braces balanced in every English string', () => {
        const violations = Object.entries(en)
            .map(([key, message]) => [key, unbalancedBrace(message)])
            .filter(([, index]) => index !== null)
            .map(([key, index]) => `${key} has an unbalanced brace at index ${index}`);

        expect(violations).toEqual([]);
    });

    it('selects singular and plural forms', async () => {
        registerLocale(TEST_LOCALE, {
            'test.addressCount': '{count, plural, one {# address} other {# addresses}}',
        });
        await setLocale(TEST_LOCALE);

        expect(t('test.addressCount', { count: 1 })).toBe('1 address');
        expect(t('test.addressCount', { count: 2 })).toBe('2 addresses');
    });

    it.each([
        [0, '0 / 10 bytes', 'Total: 5 XCP across 0 recipients, in one transaction and one network fee.', 'You can include up to 0 recipients in one payment. Create another payment for any additional recipients.', '0 of 0 history items shown', '0 Confirmations'],
        [1, '1 / 10 byte', 'Total: 5 XCP across 1 recipient, in one transaction and one network fee.', 'You can include up to 1 recipient in one payment. Create another payment for any additional recipients.', '1 of 1 history item shown', '1 Confirmation'],
        [3, '3 / 10 bytes', 'Total: 5 XCP across 3 recipients, in one transaction and one network fee.', 'You can include up to 3 recipients in one payment. Create another payment for any additional recipients.', '3 of 3 history items shown', '3 Confirmations'],
    ])('pluralizes translated count copy for %i', (count, memo, recipients, maximum, shown, confirmations) => {
        expect(t('send.memoCount', { used: count, max: 10 })).toBe(memo);
        expect(t('send.recipient.total', { total: '5 XCP', count })).toBe(recipients);
        expect(t('send.recipient.maximum', { count })).toBe(maximum);
        expect(t('history.itemsShown', { shown: count, total: count })).toBe(shown);
        expect(t('history.row.confirmations', { count })).toBe(confirmations);
    });

    it.each([
        [0, '0 protected content packs', 'packs'],
        [1, '1 protected content pack', 'pack'],
        [3, '3 protected content packs', 'packs'],
    ])('pluralizes gated pack counts for %i', (count, totalCopy, missingCopy) => {
        expect(t('send.gated.partial', {
            total: count,
            available: 0,
            missingCount: count,
            missing: 'abc',
        })).toContain(`includes ${totalCopy}`);
        expect(t('send.gated.partial', {
            total: count,
            available: 0,
            missingCount: count,
            missing: 'abc',
        })).toContain(`missing ${missingCopy}:`);
    });

    it('keeps duplicate English text only when translation context differs', () => {
        const keysByText = Object.entries(en).reduce((groups, [key, text]) => {
            const keys = groups.get(text) ?? [];
            keys.push(key);
            groups.set(text, keys);
            return groups;
        }, new Map());
        const duplicateKeyGroups = [...keysByText.values()]
            .filter((keys) => keys.length > 1)
            .map((keys) => keys.sort())
            .sort((a, b) => a[0].localeCompare(b[0]));

        expect(duplicateKeyGroups).toEqual([
            ['home.receive', 'uri.intent.receive'],
            ['send.title', 'uri.intent.send'],
        ]);
    });

    it('reports a table-driven key from a new namespace as missing', () => {
        const source = `
            import { t } from '../../i18n/index.js';
            const COPY = { ready: 'status.ready', failed: \`status.failed\` };
            t(COPY.ready);
        `;

        const { keys } = translationUsage(source);

        expect(Object.keys(en).some((key) => key.startsWith('status.'))).toBe(false);
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
