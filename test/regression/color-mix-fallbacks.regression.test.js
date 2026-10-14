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
//        backdrop-filter declarations. Source rules carry cascade fallbacks
//        so wallet surfaces remain readable and backdrop effects still work.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

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
const packagesRoot = join(repoRoot, 'packages');

function cssFilesBelow(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') return cssFilesBelow(path);
        return entry.isFile() && entry.name.endsWith('.css') ? [path] : [];
    });
}

function location(file, declaration) {
    return `${relative(repoRoot, file)}:${declaration.source.start.line}`;
}

describe('regression/CSS compatibility fallbacks', () => {
    it('[REGRESSION P1] puts a plain declaration before every color-mix() declaration', () => {
        const violations = [];

        for (const file of cssFilesBelow(packagesRoot)) {
            const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
            root.walkRules((rule) => {
                const plainProperties = new Set();
                for (const declaration of rule.nodes.filter((node) => node.type === 'decl')) {
                    const property = declaration.prop.toLowerCase();
                    if (/color-mix\s*\(/i.test(declaration.value)) {
                        if (!plainProperties.has(property)) {
                            violations.push(`${location(file, declaration)} ${declaration.prop}`);
                        }
                    } else {
                        plainProperties.add(property);
                    }
                }
            });
        }

        expect(violations, 'color-mix() declarations without an earlier plain fallback').toEqual([]);
    });

    it('[REGRESSION P1] pairs backdrop-filter with -webkit-backdrop-filter in the same rule', () => {
        const violations = [];

        for (const file of cssFilesBelow(packagesRoot)) {
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
