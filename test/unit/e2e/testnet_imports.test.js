// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const E2E = path.join(ROOT, 'test/e2e');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
});

const bindingNames = (pattern) => {
    if (pattern.type === 'Identifier') return [pattern.name];
    if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
    if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
    if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap((element) => (
        element ? bindingNames(element) : []
    ));
    if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap((property) => (
        property.type === 'RestElement' ? bindingNames(property.argument) : bindingNames(property.value)
    ));
    return [];
};

const exportedName = (node) => node.name ?? node.value;

const importedNames = (node) => node.specifiers.flatMap((specifier) => {
    if (specifier.type === 'ImportSpecifier') return [exportedName(specifier.imported)];
    if (specifier.type === 'ImportDefaultSpecifier') return ['default'];
    return [];
});

export function collectImportFailures(files, readModule) {
    const astCache = new Map();
    const read = (file) => {
        try {
            return readModule(file);
        } catch {
            return null;
        }
    };
    const resolveRelative = (file, source) => {
        const base = path.resolve(path.dirname(file), source);
        const candidates = path.extname(base)
            ? [base]
            : [base, `${base}.js`, path.join(base, 'index.js')];
        return candidates.find((candidate) => read(candidate) !== null) ?? null;
    };
    const astFor = (file) => {
        if (!astCache.has(file)) {
            const source = read(file);
            astCache.set(file, source === null ? null : parse(source, {
                sourceType: 'module',
                plugins: ['jsx'],
            }));
        }
        return astCache.get(file);
    };
    const collectExports = (file, visited = new Set()) => {
        if (visited.has(file)) return new Set();
        visited.add(file);
        const names = new Set();
        const ast = astFor(file);
        if (!ast) return names;
        for (const node of ast.program.body) {
            if (node.type === 'ExportDefaultDeclaration') {
                names.add('default');
            } else if (node.type === 'ExportNamedDeclaration') {
                if (node.declaration?.id) names.add(node.declaration.id.name);
                for (const declaration of node.declaration?.declarations ?? []) {
                    bindingNames(declaration.id).forEach((name) => names.add(name));
                }
                for (const specifier of node.specifiers) names.add(exportedName(specifier.exported));
            } else if (node.type === 'ExportAllDeclaration' && node.source.value.startsWith('.')) {
                const target = resolveRelative(file, node.source.value);
                if (target?.endsWith('.js')) {
                    for (const name of collectExports(target, visited)) {
                        if (name !== 'default') names.add(name);
                    }
                }
            }
        }
        return names;
    };

    const failures = [];
    for (const { file, source } of files) {
        const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
        for (const node of ast.program.body) {
            if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
            const request = node.source.value;
            const names = importedNames(node);
            const target = resolveRelative(file, request);
            if (!target) {
                for (const name of names.length ? names : ['<module>']) {
                    failures.push({ file, source: request, name });
                }
                continue;
            }
            if (!target.endsWith('.js')) continue;
            const exports = collectExports(target);
            for (const name of names) {
                if (!exports.has(name)) failures.push({ file, source: request, name });
            }
        }
    }
    return failures;
}

const targets = () => [
    ...walk(path.join(E2E, 'tests')).filter((file) => file.endsWith('.testnet.spec.js')),
    ...fs.readdirSync(path.join(E2E, 'fixtures'))
        .filter((file) => /^testnet.*\.js$/.test(file))
        .map((file) => path.join(E2E, 'fixtures', file)),
    path.join(E2E, 'global-setup.testnet.js'),
    path.join(E2E, 'playwright.testnet.config.js'),
];

describe('testnet relative imports resolve to exported names', () => {
    it('reports a requested name missing from an inline module pair', () => {
        const importer = path.join('/inline', 'importer.js');
        const exporter = path.join('/inline', 'exporter.js');
        const modules = new Map([
            [importer, "import configured, { missing, present } from './exporter.js';"],
            [exporter, 'export default true; export const present = true;'],
        ]);
        expect(collectImportFailures(
            [{ file: importer, source: modules.get(importer) }],
            (file) => modules.get(file) ?? null,
        )).toEqual([{ file: importer, source: './exporter.js', name: 'missing' }]);
    });

    it('follows relative export-all declarations through a cycle', () => {
        const importer = path.join('/inline', 'importer.js');
        const barrel = path.join('/inline', 'barrel.js');
        const origin = path.join('/inline', 'origin.js');
        const modules = new Map([
            [importer, "import { present } from './barrel.js';"],
            [barrel, "export * from './origin.js';"],
            [origin, "export const present = true; export * from './barrel.js';"],
        ]);
        expect(collectImportFailures(
            [{ file: importer, source: modules.get(importer) }],
            (file) => modules.get(file) ?? null,
        )).toEqual([]);
    });

    it('finds valid relative imports across every testnet support file and spec', () => {
        const files = targets();
        const relative = files.map((file) => path.relative(ROOT, file));
        expect(relative).toEqual(expect.arrayContaining([
            'test/e2e/tests/staking/partial-claim.testnet.spec.js',
            'test/e2e/tests/staking/stake-unstake.testnet.spec.js',
        ]));
        expect(collectImportFailures(
            files.map((file) => ({ file, source: fs.readFileSync(file, 'utf8') })),
            (file) => fs.readFileSync(file, 'utf8'),
        )).toEqual([]);
    });
});
