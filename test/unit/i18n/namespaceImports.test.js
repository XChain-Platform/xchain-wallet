// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The English dictionary loads by namespace (packages/core/src/i18n/locales/en/).
// i18n/index.js loads the startup files; every other file registers itself
// when a module that renders its keys imports it. A module that names a key
// from a namespace it does not import renders the raw key until something
// else happens to load that namespace, so this test holds the rules that keep
// the copy in place before any screen renders:
//   - each key lives in the file named after its first segment, or in a
//     startup file (errors.js for the error states, firstPaint.js for later
//     keys the first screens render);
//   - i18n/index.js imports exactly the startup files;
//   - every wallet module imports each non-startup namespace whose keys it
//     names;
//   - a module that imports a namespace has no other top-level side effect,
//     which the web build's i18nNamespacePlugin relies on to drop an unused
//     module together with its namespace import.

import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const namespaceSources = import.meta.glob(
    ['../../../packages/core/src/i18n/locales/en/*.js', '!../../../packages/core/src/i18n/locales/en/index.js'],
    { query: '?raw', import: 'default', eager: true },
);
const namespaceModules = import.meta.glob(
    ['../../../packages/core/src/i18n/locales/en/*.js', '!../../../packages/core/src/i18n/locales/en/index.js'],
    { import: 'default', eager: true },
);
const i18nIndexSource = import.meta.glob('../../../packages/core/src/i18n/index.js', {
    query: '?raw', import: 'default', eager: true,
});
const sources = import.meta.glob([
    '../../../packages/*/src/**/*.{js,jsx,mjs}',
    '../../../packages/desktop/renderer/**/*.{js,jsx,mjs}',
    '!../../../packages/core/src/i18n/locales/**',
    '!../../../packages/*/src/**/*.test.{js,jsx}',
    '!**/node_modules/**',
    '!**/dist/**',
], { query: '?raw', import: 'default', eager: true });

const STARTUP_PREFIX_FILES = ['common', 'home', 'locked', 'onboarding', 'shell'];
const ERROR_PREFIXES = ['loading', 'offline', 'reachability', 'routeNotFound', 'vaultUnavailable'];
const STARTUP_FILES = [...STARTUP_PREFIX_FILES, 'errors', 'firstPaint'].sort();

const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1, -'.js'.length);
const short = (path) => path.replace(/^(\.\.\/)+/, '');

const fileOfKey = new Map();
for (const [path, messages] of Object.entries(namespaceModules)) {
    for (const key of Object.keys(messages)) fileOfKey.set(key, nameOf(path));
}
const keys = Object.keys(en);
// Every dotted prefix of a key (`settings.`, `settings.backup.`), so a module
// that builds a key from a literal prefix is held to every key under it.
const keyPrefixes = new Map();
for (const key of keys) {
    const parts = key.split('.');
    for (let i = 1; i < parts.length; i += 1) {
        const prefix = `${parts.slice(0, i).join('.')}.`;
        if (!keyPrefixes.has(prefix)) keyPrefixes.set(prefix, []);
        keyPrefixes.get(prefix).push(key);
    }
}

/** Keys a module names: quoted keys, plus every key under a quoted prefix. */
function keysNamedIn(source) {
    const named = new Set();
    const rendersCopy = /i18n/.test(source);
    const addPrefix = (prefix) => {
        if (rendersCopy) for (const key of keyPrefixes.get(prefix) ?? []) named.add(key);
    };
    for (const [, token] of source.matchAll(/['"`]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"`]/g)) {
        if (fileOfKey.has(token)) named.add(token);
        addPrefix(`${token}.`);
    }
    for (const [, prefix] of source.matchAll(/`([A-Za-z][\w-]*(?:\.[\w-]+)*\.)\$\{/g)) addPrefix(prefix);
    for (const [, prefix] of source.matchAll(/['"]([A-Za-z][\w-]*(?:\.[\w-]+)*\.)['"]\s*\+/g)) addPrefix(prefix);
    return named;
}

const NAMESPACE_IMPORT = /^import '(?:[^']*\/)?locales\/en\/(\w+)\.js';$/gm;
const importedNamespaces = (source) => new Set([...source.matchAll(NAMESPACE_IMPORT)].map((m) => m[1]));

describe('English namespace files', () => {
    it('hold every key exactly once', () => {
        const total = Object.values(namespaceModules).reduce((n, m) => n + Object.keys(m).length, 0);
        expect(total).toBe(keys.length);
        expect(fileOfKey.size).toBe(keys.length);
    });

    it('keep each key in its own namespace file or in a startup file', () => {
        const misplaced = [];
        for (const [key, file] of fileOfKey) {
            const prefix = key.split('.')[0];
            const ok = file === prefix
                || file === 'firstPaint'
                || (file === 'errors' && ERROR_PREFIXES.includes(prefix));
            const startupPrefix = STARTUP_PREFIX_FILES.includes(prefix) || ERROR_PREFIXES.includes(prefix);
            if (!ok || (startupPrefix && file === 'firstPaint')) misplaced.push(`${key} in ${file}.js`);
        }
        expect(misplaced).toEqual([]);
    });

    it('register themselves into the shared store', () => {
        for (const [path, source] of Object.entries(namespaceSources)) {
            expect(source, short(path)).toMatch(/^import \{ addEnglish \} from '\.\.\/\.\.\/store\.js';$/m);
            expect(source, short(path)).toMatch(/^addEnglish\(messages\);$/m);
        }
    });

    it('load at startup only for the startup namespaces', () => {
        const [indexSource] = Object.values(i18nIndexSource);
        expect([...importedNamespaces(indexSource)].sort()).toEqual(STARTUP_FILES);
    });
});

describe('modules that render English keys', () => {
    // i18n/index.js is the loader: it imports the startup files on purpose.
    const modules = Object.entries(sources).filter(([path]) => !path.endsWith('core/src/i18n/index.js'));

    it('scans the wallet shells', () => {
        expect(modules.length).toBeGreaterThan(500);
        expect(modules.some(([path]) => path.endsWith('core/src/shared/routes/Settings.jsx'))).toBe(true);
        expect(modules.some(([path]) => path.endsWith('extension/src/approval/kinds/SignApproval.jsx'))).toBe(true);
    });

    it('import every later namespace whose keys they name', () => {
        const missing = [];
        let checked = 0;
        for (const [path, source] of modules) {
            const named = keysNamedIn(source);
            if (!named.size) continue;
            checked += 1;
            const imported = importedNamespaces(source);
            const need = new Set();
            for (const key of named) {
                const file = fileOfKey.get(key);
                if (!STARTUP_FILES.includes(file) && !imported.has(file)) need.add(file);
            }
            if (need.size) missing.push(`${short(path)} needs ${[...need].sort().join(', ')}`);
        }
        expect(checked).toBeGreaterThan(150);
        expect(missing).toEqual([]);
    });

    it('import no namespace they do not use', () => {
        const unused = [];
        for (const [path, source] of modules) {
            const imported = importedNamespaces(source);
            if (!imported.size) continue;
            const used = new Set([...keysNamedIn(source)].map((key) => fileOfKey.get(key)));
            for (const file of imported) if (!used.has(file)) unused.push(`${short(path)} imports ${file}.js`);
        }
        expect(unused).toEqual([]);
    });

    it('have no other top-level side effect when they import a namespace', () => {
        const effects = [];
        for (const [path, source] of modules) {
            if (!importedNamespaces(source).size) continue;
            const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
            for (const node of ast.program.body) {
                if (node.type === 'ExpressionStatement') {
                    effects.push(`${short(path)}:${node.loc.start.line} top-level statement`);
                }
                if (node.type === 'ImportDeclaration' && node.specifiers.length === 0
                    && !/locales\/en\//.test(node.source.value)) {
                    effects.push(`${short(path)}:${node.loc.start.line} bare import ${node.source.value}`);
                }
            }
        }
        expect(effects).toEqual([]);
    });
});
