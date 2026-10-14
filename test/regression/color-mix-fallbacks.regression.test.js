// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: CSS fallbacks for older embedded browsers.
//
//   [P1] 2026-10-13: Older WebViews discard unsupported color-mix() and
//        backdrop-filter declarations. The web build (which the mobile
//        shells also ship) flattens every color-mix() into a plain color
//        behind @supports, and backdrop rules carry the WebKit prefix, so
//        wallet surfaces stay readable and backdrop effects still work.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { colorMixFallback, NO_COLOR_MIX } from '../../packages/web/cssFallbacks.js';

function findRepoRoot() {
    let directory = process.cwd();
    while (!existsSync(join(directory, 'packages'))) {
        const parent = dirname(directory);
        if (parent === directory) throw new Error('packages directory not found above the cwd');
        directory = parent;
    }
    return directory;
}

const repoRoot = findRepoRoot();
// Authored CSS that reaches the web bundle; build output is not source.
const webSourceRoots = [
    join(repoRoot, 'packages', 'core', 'src'),
    join(repoRoot, 'packages', 'web', 'src'),
];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);

function cssFilesBelow(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : cssFilesBelow(path);
        return entry.isFile() && entry.name.endsWith('.css') ? [path] : [];
    });
}

function location(file, declaration) {
    return `${relative(repoRoot, file)}:${declaration.source.start.line}`;
}

function supportsFallbackFor(rule) {
    const next = rule.next();
    if (!next || next.type !== 'atrule' || next.name !== 'supports' || next.params !== NO_COLOR_MIX) return null;
    const copy = next.nodes.find((node) => node.type === 'rule' && node.selector === rule.selector);
    return copy ? copy.nodes.filter((node) => node.type === 'decl') : null;
}

describe('regression/CSS compatibility fallbacks', () => {
    it('[REGRESSION P1] gives every color-mix() declaration a plain fallback in the web build', () => {
        const violations = [];
        let mixed = 0;

        for (const file of webSourceRoots.flatMap(cssFilesBelow)) {
            const source = readFileSync(file, 'utf8');
            if (!source.includes('color-mix(')) continue;
            const root = postcss([colorMixFallback()]).process(source, { from: file }).root;
            root.walkRules((rule) => {
                if (rule.parent?.type === 'atrule' && rule.parent.params === NO_COLOR_MIX) return;
                const fallback = supportsFallbackFor(rule) ?? [];
                const plainProperties = new Set();
                for (const declaration of rule.nodes.filter((node) => node.type === 'decl')) {
                    const property = declaration.prop.toLowerCase();
                    if (!/color-mix\s*\(/i.test(declaration.value)) {
                        plainProperties.add(property);
                        continue;
                    }
                    mixed += 1;
                    const flattened = fallback.find((node) => node.prop.toLowerCase() === property);
                    const covered = plainProperties.has(property)
                        || (flattened && !/color-mix\s*\(/i.test(flattened.value));
                    if (!covered) violations.push(`${location(file, declaration)} ${declaration.prop}`);
                }
            });
        }

        expect(mixed).toBeGreaterThan(0);
        expect(violations, 'color-mix() declarations the build cannot flatten').toEqual([]);
    });

    it('[REGRESSION P1] pairs backdrop-filter with -webkit-backdrop-filter in the same rule', () => {
        const violations = [];

        for (const file of webSourceRoots.flatMap(cssFilesBelow)) {
            const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
            root.walkRules((rule) => {
                const declarations = rule.nodes.filter((node) => node.type === 'decl');
                const properties = new Set(declarations.map((declaration) => declaration.prop.toLowerCase()));
                if (properties.has('backdrop-filter') && !properties.has('-webkit-backdrop-filter')) {
                    const declaration = declarations.find((node) => node.prop.toLowerCase() === 'backdrop-filter');
                    violations.push(location(file, declaration));
                }
            });
        }

        expect(violations, 'backdrop-filter declarations without a same-rule WebKit prefix').toEqual([]);
    });
});
