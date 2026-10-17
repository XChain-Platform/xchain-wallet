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
import { describe, expect, it } from 'vitest';

import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import missingBaseline from './missing-keys-baseline.json';

const traverse = _traverse.default || _traverse;
const sources = import.meta.glob([
    '../../../packages/core/src/**/*.{js,jsx,mjs,cjs}',
    '../../../packages/web/src/**/*.{js,jsx,mjs,cjs}',
    '../../../packages/extension/src/**/*.{js,jsx,mjs,cjs}',
    '../../../packages/desktop/**/*.{js,jsx,mjs,cjs}',
    '!../../../packages/desktop/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PARSER_PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait'];

function addAll(target, source) {
    for (const value of source) target.add(value);
}

// The file being scanned, so a relative import can be followed one hop into a
// sibling source (History.jsx reads its pending copy tables from HistoryShared.jsx).
let currentFile = null;
const siblingScopes = new Map();

function siblingProgramScope(key) {
    if (!siblingScopes.has(key)) {
        const ast = parse(sources[key], { sourceType: 'unambiguous', plugins: PARSER_PLUGINS });
        let programScope = null;
        traverse(ast, { Program(path) { programScope = path.scope; path.stop(); } });
        siblingScopes.set(key, programScope);
    }
    return siblingScopes.get(key);
}

function followRelativeImport(binding) {
    if (!currentFile || !binding?.path.isImportSpecifier()) return binding;
    const from = binding.path.parentPath.node.source.value;
    if (!from.startsWith('./')) return binding;
    const target = `${currentFile.slice(0, currentFile.lastIndexOf('/'))}/${from.slice(2)}`;
    const key = Object.keys(sources).find((k) => k.replace(/^(\.\.\/)+/, '') === target);
    if (!key) return binding;
    const imported = binding.path.node.imported;
    return siblingProgramScope(key)?.getBinding(imported.name) ?? binding;
}

function staticStrings(node, scope, seenBindings = new Set()) {
    if (!node || node.type === 'NullLiteral') return { strings: new Set(), resolved: true };
    if (node.type === 'StringLiteral') return { strings: new Set([node.value]), resolved: true };
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return { strings: new Set([node.quasis[0]?.value.cooked ?? '']), resolved: true };
    }
    if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
        const left = staticStrings(
            node.type === 'ConditionalExpression' ? node.consequent : node.left,
            scope,
            new Set(seenBindings),
        );
        const right = staticStrings(
            node.type === 'ConditionalExpression' ? node.alternate : node.right,
            scope,
            new Set(seenBindings),
        );
        addAll(left.strings, right.strings);
        return { strings: left.strings, resolved: left.resolved && right.resolved };
    }
    if (node.type === 'Identifier') {
        const binding = followRelativeImport(scope.getBinding(node.name));
        if (!binding || seenBindings.has(binding) || !binding.path.isVariableDeclarator()) {
            return { strings: new Set(), resolved: false };
        }
        const nextSeen = new Set(seenBindings).add(binding);
        return staticStrings(binding.path.node.init, binding.path.scope, nextSeen);
    }
    if (node.type === 'ObjectExpression') {
        const strings = new Set();
        let resolved = true;
        for (const property of node.properties) {
            const result = property.type === 'ObjectProperty'
                ? staticStrings(property.value, scope, new Set(seenBindings))
                : property.type === 'SpreadElement'
                    ? staticStrings(property.argument, scope, new Set(seenBindings))
                    : { strings: new Set(), resolved: false };
            addAll(strings, result.strings);
            resolved &&= result.resolved;
        }
        return { strings, resolved };
    }
    if (node.type === 'MemberExpression') {
        return staticStrings(node.object, scope, seenBindings);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        const binding = followRelativeImport(scope.getBinding(node.callee.name));
        if (!binding || seenBindings.has(binding)) return { strings: new Set(), resolved: false };
        const nextSeen = new Set(seenBindings).add(binding);
        let functionPath = binding.path;
        if (functionPath.isVariableDeclarator()) functionPath = functionPath.get('init');
        if (!functionPath.isFunction()) return { strings: new Set(), resolved: false };
        if (functionPath.isArrowFunctionExpression() && !functionPath.get('body').isBlockStatement()) {
            return staticStrings(functionPath.node.body, functionPath.scope, nextSeen);
        }

        const returns = [];
        functionPath.traverse({
            Function(path) {
                path.skip();
            },
            ReturnStatement(path) {
                returns.push(path);
            },
        });
        const strings = new Set();
        let resolved = returns.length > 0;
        for (const returnPath of returns) {
            const result = staticStrings(
                returnPath.node.argument,
                returnPath.scope,
                new Set(nextSeen),
            );
            addAll(strings, result.strings);
            resolved &&= result.resolved;
        }
        return { strings, resolved };
    }
    return { strings: new Set(), resolved: false };
}

function isTranslateBinding(binding) {
    if (binding?.path.isImportSpecifier()) {
        const imported = binding.path.node.imported;
        const declaration = binding.path.parentPath;
        return imported.type === 'Identifier'
            && imported.name === 't'
            && declaration.isImportDeclaration()
            && declaration.node.source.value.endsWith('/i18n/index.js');
    }
    if (!binding?.path.isVariableDeclarator()) return false;
    const declarator = binding.path.node;
    const init = declarator.init;
    if (declarator.id.type === 'Identifier'
        && declarator.id.name === binding.identifier.name
        && (init?.type === 'MemberExpression' || init?.type === 'OptionalMemberExpression')
        && init.property.type === 'Identifier'
        && init.property.name === 't'
        && (init.object.type === 'MemberExpression' || init.object.type === 'OptionalMemberExpression')
        && init.object.property.type === 'Identifier'
        && init.object.property.name === 'i18n') {
        return true;
    }
    if (declarator.id.type !== 'ObjectPattern' || declarator.init?.type !== 'Identifier') {
        return false;
    }
    const selectsT = declarator.id.properties.some((property) => (
        property.type === 'ObjectProperty'
        && property.key.type === 'Identifier'
        && property.key.name === 't'
        && property.value.type === 'Identifier'
        && property.value.name === binding.identifier.name
    ));
    if (!selectsT) return false;
    const namespaceBinding = binding.path.scope.getBinding(declarator.init.name);
    if (!namespaceBinding?.path.isImportSpecifier()) return false;
    const imported = namespaceBinding.path.node.imported;
    const declaration = namespaceBinding.path.parentPath;
    return imported.type === 'Identifier'
        && imported.name === 'i18n'
        && declaration.isImportDeclaration()
        && declaration.node.source.value === '@xchain-wallet/core';
}

function translationUsage(file, source) {
    currentFile = file;
    const ast = parse(source, {
        sourceType: 'unambiguous',
        plugins: PARSER_PLUGINS,
    });
    const keys = new Set();
    const unresolved = [];

    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.type !== 'Identifier') return;
            if (!isTranslateBinding(path.scope.getBinding(path.node.callee.name))) return;
            const result = staticStrings(path.node.arguments[0], path.scope);
            addAll(keys, result.strings);
            if (!result.resolved || result.strings.size === 0) {
                unresolved.push(`${file}:${path.node.loc?.start.line ?? '?'}`);
            }
        },
    });

    return { keys, unresolved };
}

function collectUsage(entries) {
    const keys = new Set();
    const unresolved = [];
    const translatedFiles = [];
    for (const [file, source] of entries) {
        const displayFile = file.replace(/^(\.\.\/)+/, '');
        const usage = translationUsage(displayFile, source);
        addAll(keys, usage.keys);
        unresolved.push(...usage.unresolved);
        if (usage.keys.size > 0 || usage.unresolved.length > 0) translatedFiles.push(displayFile);
    }
    return { keys, translatedFiles, unresolved };
}

describe('English translation key coverage', () => {
    it('extracts keys from calls to the imported translator', () => {
        const source = `
            import { i18n } from '@xchain-wallet/core';
            import { t as directTranslate } from '../../i18n/index.js';
            const { t: translate } = i18n;
            function describe(deps) {
                const injectedTranslate = deps.i18n.t;
                return injectedTranslate('status.injected');
            }
            const COPY = { ready: 'status.ready', failed: 'status.failed' };
            translate(COPY.ready);
            translate(true ? 'status.saved' : 'status.cancelled');
            directTranslate('status.direct');
        `;

        const usage = translationUsage('fixture.js', source);

        expect([...usage.keys].sort()).toEqual([
            'status.cancelled',
            'status.direct',
            'status.failed',
            'status.injected',
            'status.ready',
            'status.saved',
        ]);
        expect(usage.unresolved).toEqual([]);
    });

    it('does not add missing keys beyond the audited baseline', () => {
        const usage = collectUsage(Object.entries(sources));
        const missing = [...usage.keys]
            .filter((key) => typeof en[key] !== 'string')
            .sort();
        const unexpected = missing.filter((key) => !missingBaseline.includes(key));

        expect(Object.keys(sources).length).toBeGreaterThan(500);
        expect(usage.keys.size).toBeGreaterThan(500);
        expect(usage.translatedFiles).toEqual(expect.arrayContaining([
            'packages/core/src/shared/routes/History.jsx',
            'packages/web/src/App.jsx',
            'packages/extension/src/popup/App.jsx',
            'packages/desktop/renderer/App.jsx',
        ]));
        expect(usage.unresolved).toEqual([]);
        expect(missingBaseline).toEqual([...new Set(missingBaseline)].sort());
        expect(unexpected).toEqual([]);
    });
});
