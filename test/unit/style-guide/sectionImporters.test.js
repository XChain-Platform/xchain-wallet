// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const sectionModules = import.meta.glob(
    '../../../packages/web/src/style-guide/sections/*.jsx',
    { eager: true },
);
const sectionSources = import.meta.glob(
    '../../../packages/web/src/style-guide/sections/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);
const productSources = import.meta.glob(
    [
        '../../../packages/*/src/**/*.{js,jsx}',
        '!../../../packages/web/src/style-guide/**',
    ],
    { query: '?raw', import: 'default', eager: true },
);

const parserPlugins = ['jsx', 'decorators-legacy', 'importAssertions'];
const repoPath = (path) => path.replace(/^(\.\.\/)+/, '');

function isCoreImport(file, specifier) {
    if (specifier === '@xchain-wallet/core'
        || specifier.startsWith('@xchain-wallet/core/')) return true;
    if (!specifier.startsWith('.')) return false;
    const resolved = posix.normalize(posix.join(posix.dirname(repoPath(file)), specifier));
    return resolved.startsWith('packages/core/src/');
}

function scanSource(file, code) {
    const imported = new Set();
    const coreImported = new Set();
    const rendered = new Set();
    const ast = parse(code, { sourceType: 'module', plugins: parserPlugins });

    traverse(ast, {
        ImportDeclaration({ node }) {
            const source = node.source.value;
            const productImport = source.startsWith('.')
                || source.startsWith('@xchain-wallet/');
            for (const specifier of node.specifiers) {
                const canonical = specifier.imported?.name
                    ?? specifier.imported?.value
                    ?? specifier.local.name;
                if (productImport) {
                    imported.add(canonical);
                    imported.add(specifier.local.name);
                    const basename = posix.basename(source).replace(/\.[^.]+$/, '');
                    if (specifier.type === 'ImportDefaultSpecifier' && basename !== 'index') {
                        imported.add(basename);
                    }
                }
                if (isCoreImport(file, source) && /^[A-Z]/.test(canonical)) {
                    coreImported.add(canonical);
                }
            }
        },
        JSXOpeningElement({ node }) {
            let name = node.name;
            while (name.type === 'JSXMemberExpression') name = name.object;
            if (name.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)) {
                rendered.add(name.name);
            }
        },
    });
    return { imported, coreImported, rendered };
}

function namesFrom(scans, key) {
    return new Set(scans.flatMap((scan) => [...scan[key]]));
}

function metadataFromModules(modules) {
    return Object.entries(modules).flatMap(([path, module]) =>
        (module.SECTION_META ?? []).map((meta) => ({ ...meta, path })));
}

function missingImporters(metas, imported) {
    return metas.flatMap((meta) => [
        ...(meta.components ?? []),
        ...(meta.primitives ?? []),
    ].filter((name) => !imported.has(name)).map((name) => `${meta.id}: ${name}`));
}

function missingCoreUses(sections, used) {
    return sections.flatMap(({ path, source }) =>
        [...scanSource(path, source).coreImported]
            .filter((name) => !used.has(name))
            .map((name) => `${repoPath(path)}: ${name}`));
}

const metas = metadataFromModules(sectionModules);
const metaSections = [...new Set(metas.map(({ path }) => path))]
    .map((path) => ({ path, source: sectionSources[path] }));
const productScans = Object.entries(productSources)
    .map(([path, source]) => scanSource(path, source));
const productImports = namesFrom(productScans, 'imported');
const productUses = new Set([
    ...productImports,
    ...namesFrom(productScans, 'rendered'),
]);

describe('style guide section importers', () => {
    it('discovers section modules and shipped sources', () => {
        expect(Object.keys(sectionModules).length).toBeGreaterThan(10);
        expect(Object.keys(productSources).length).toBeGreaterThan(100);
    });

    it('scopes pre-closing checks to metadata sections', () => {
        const modules = {
            './LegacySection.jsx': { LegacySection: () => null },
            './MetaSection.jsx': { SECTION_META: [{ id: 'meta' }] },
        };
        expect(metadataFromModules(modules)).toEqual([
            { id: 'meta', path: './MetaSection.jsx' },
        ]);
    });

    it('keeps every documented name imported by shipped source', () => {
        expect(missingImporters(metas, productImports)).toEqual([]);
    });

    it('keeps every core demo import used by shipped source', () => {
        expect(missingCoreUses(metaSections, productUses)).toEqual([]);
    });

    it('rejects a planted documented component with no importer', () => {
        const planted = [{ id: 'fixture', components: ['GuideOnly'] }];
        expect(missingImporters(planted, new Set())).toEqual(['fixture: GuideOnly']);
    });

    it('rejects a planted core import used only by the guide', () => {
        const planted = [{
            path: 'packages/web/src/style-guide/sections/FixtureSection.jsx',
            source: "import { GuideOnly } from '@xchain-wallet/core/ui';",
        }];
        expect(missingCoreUses(planted, new Set())).toEqual([
            'packages/web/src/style-guide/sections/FixtureSection.jsx: GuideOnly',
        ]);
    });
});
