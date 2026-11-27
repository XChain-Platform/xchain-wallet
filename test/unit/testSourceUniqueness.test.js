// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { beforeAll, describe, expect, it } from 'vitest';

import { slowTimeout } from '../helpers/testEnvSpeed.js';

const traverse = _traverse.default || _traverse;
const UNIT_ROOT = resolve(process.cwd(), 'test/unit');

function unitTestFiles(directory = UNIT_ROOT) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return unitTestFiles(path);
        return /\.test\.(?:js|jsx)$/.test(entry.name) ? [path] : [];
    });
}

function parseTestFile(file) {
    return parse(readFileSync(file, 'utf8'), {
        sourceType: 'module',
        plugins: ['jsx', 'importAttributes', 'topLevelAwait'],
    });
}

function declarationKind(callee) {
    if (callee?.type === 'Identifier' && ['describe', 'it', 'test'].includes(callee.name)) {
        return callee.name === 'describe' ? 'suite' : 'test';
    }
    if (callee?.type === 'MemberExpression' && !callee.computed) {
        return declarationKind(callee.object);
    }
    if (callee?.type === 'CallExpression') return declarationKind(callee.callee);
    return null;
}

function staticTitle(call) {
    const title = call.arguments[0];
    if (title?.type === 'StringLiteral') return title.value;
    if (title?.type === 'TemplateLiteral' && title.expressions.length === 0) {
        return title.quasis[0]?.value.cooked;
    }
    return null;
}

function enclosingSuiteTitles(path) {
    const titles = [];
    let cursor = path.parentPath;
    while (cursor) {
        if (
            ['ArrowFunctionExpression', 'FunctionExpression'].includes(cursor.node.type)
            && cursor.parentPath?.isCallExpression()
            && cursor.parentPath.node.arguments[1] === cursor.node
            && declarationKind(cursor.parentPath.node.callee) === 'suite'
        ) {
            const title = staticTitle(cursor.parentPath.node);
            if (title !== null) titles.unshift(title);
        }
        cursor = cursor.parentPath;
    }
    return titles;
}

// One pass parses every unit test file once and collects both checks' findings.
// Two scans, each parsing and traversing the whole tree, ran past the 20s test
// timeout on CI runners at about 3,500 files. Imports can only sit at the top
// level of a module, so they are read from the program body without a traverse.
// The ASTs are not kept, because holding every one of them costs gigabytes.
function scanUnitTests() {
    const duplicateImports = [];
    const duplicateNames = [];

    for (const file of unitTestFiles()) {
        const ast = parseTestFile(file);

        const imports = new Map();
        for (const node of ast.program.body) {
            if (node.type !== 'ImportDeclaration') continue;
            const lines = imports.get(node.source.value) || [];
            lines.push(node.loc.start.line);
            imports.set(node.source.value, lines);
        }
        for (const [source, lines] of imports) {
            if (lines.length > 1) {
                duplicateImports.push(`${relative(UNIT_ROOT, file)} imports ${source} on lines ${lines.join(', ')}`);
            }
        }

        const declarations = new Map();
        traverse(ast, {
            CallExpression(path) {
                const kind = declarationKind(path.node.callee);
                const title = staticTitle(path.node);
                if (!kind || title === null) return;
                const qualifiedTitle = [...enclosingSuiteTitles(path), title].join(' > ');
                const key = `${kind}:${qualifiedTitle}`;
                const lines = declarations.get(key) || [];
                lines.push(path.node.loc.start.line);
                declarations.set(key, lines);
            },
        });
        for (const [name, lines] of declarations) {
            if (lines.length > 1) {
                duplicateNames.push(`${basename(file)} has ${name} on lines ${lines.join(', ')}`);
            }
        }
    }

    return { duplicateImports, duplicateNames };
}

describe('unit test source uniqueness', () => {
    let scan;

    // The scan grows with the tree, so it carries its own budget instead of
    // the default hook timeout; slowTimeout stretches it for an instrumented run.
    beforeAll(() => {
        scan = scanUnitTests();
    }, slowTimeout(60_000));

    it('imports each module at most once per file', () => {
        expect(scan.duplicateImports).toEqual([]);
    });

    it('gives each suite and test a unique fully qualified name', () => {
        expect(scan.duplicateNames).toEqual([]);
    });
});
