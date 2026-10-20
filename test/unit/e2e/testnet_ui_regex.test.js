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
const CORE_SRC = path.join(ROOT, 'packages/core/src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
});

const methodName = (call) => {
    const { callee } = call;
    if (callee?.type !== 'MemberExpression' && callee?.type !== 'OptionalMemberExpression') return null;
    if (!callee.computed && callee.property.type === 'Identifier') return callee.property.name;
    if (callee.computed && callee.property.type === 'StringLiteral') return callee.property.value;
    return null;
};

const roleNameRegex = (call) => {
    const options = call.arguments[1];
    if (options?.type !== 'ObjectExpression') return null;
    const property = options.properties.find((candidate) => candidate.type === 'ObjectProperty'
        && ((candidate.key.type === 'Identifier' && candidate.key.name === 'name')
            || (candidate.key.type === 'StringLiteral' && candidate.key.value === 'name')));
    return property?.value?.type === 'RegExpLiteral' ? property.value : null;
};

// Only RegExpLiteral nodes count; new RegExp(...), template and string
// arguments are not regex literals and are skipped here.
export function collectUiPatterns(source) {
    const found = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
            const method = methodName(node);
            let literal = null;
            if (method === 'getByRole') literal = roleNameRegex(node);
            else if ((method === 'getByText' || method === 'getByLabel')
                && node.arguments[0]?.type === 'RegExpLiteral') literal = node.arguments[0];
            if (literal) {
                found.push({
                    kind: method,
                    line: literal.loc.start.line,
                    pattern: literal.pattern,
                    flags: literal.flags,
                });
            }
        }
        Object.values(node).forEach(visit);
    };
    visit(parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] }));
    return found;
}

const METACHARS = new Set(['.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '^', '$']);

// Literal pieces of a pattern: a leading ^ and trailing $ dropped, split on
// escapes that are not punctuation (\b, \d, \s, ...) and on bare metacharacters.
function literalPieces(pattern) {
    let body = pattern;
    if (body.startsWith('^')) body = body.slice(1);
    if (body.endsWith('$') && !body.endsWith('\\$')) body = body.slice(0, -1);
    const pieces = [''];
    for (let i = 0; i < body.length; i += 1) {
        const char = body[i];
        if (char === '\\') {
            const next = body[i + 1] ?? '';
            i += 1;
            if (/[A-Za-z0-9]/.test(next)) pieces.push('');
            else pieces[pieces.length - 1] += next;
        } else if (METACHARS.has(char)) {
            pieces.push('');
        } else {
            pieces[pieces.length - 1] += char;
        }
    }
    return pieces;
}

export const longestFragment = (pattern) => literalPieces(pattern)
    .reduce((best, piece) => (piece.length > best.length ? piece : best), '');

export function invalidUiPatterns(files, sources) {
    const failures = new Set();
    const lowered = sources.map((candidate) => candidate.toLowerCase());
    for (const [name, source] of files) {
        for (const { line, pattern, flags } of collectUiPatterns(source)) {
            const fragment = longestFragment(pattern);
            if (!fragment) continue;
            const held = flags.includes('i')
                ? lowered.some((candidate) => candidate.includes(fragment.toLowerCase()))
                : sources.some((candidate) => candidate.includes(fragment));
            if (!held) failures.add(`${name}:${line} /${pattern}/${flags}`);
        }
    }
    return [...failures];
}

const targets = () => [
    ...walk(path.join(E2E, 'tests')).filter((file) => file.endsWith('.testnet.spec.js')),
    ...fs.readdirSync(path.join(E2E, 'fixtures'))
        .filter((file) => /^testnet.*\.js$/.test(file))
        .map((file) => path.join(E2E, 'fixtures', file)),
];

const coreSources = () => walk(CORE_SRC).map((file) => fs.readFileSync(file, 'utf8'));

describe('testnet e2e UI regex locators', () => {
    it('reports only the unmatched regex and skips new RegExp calls', () => {
        const sample = [
            "page.getByText(/^known copy\\./);",
            "page.getByRole('button', { name: /^Planted unmatched\\b/ });",
            "page.getByLabel(/KNOWN LABEL$/i);",
            "page.getByText(new RegExp('constructed unmatched'));",
            "page.getByText('string unmatched');",
            'page.getByText(`template ${unmatched}`);',
        ].join('\n');
        expect(collectUiPatterns(sample)).toEqual([
            { kind: 'getByText', line: 1, pattern: '^known copy\\.', flags: '' },
            { kind: 'getByRole', line: 2, pattern: '^Planted unmatched\\b', flags: '' },
            { kind: 'getByLabel', line: 3, pattern: 'KNOWN LABEL$', flags: 'i' },
        ]);
        expect(invalidUiPatterns(
            [['sample.js', sample]],
            ['says known copy. here', 'a known label'],
        )).toEqual(['sample.js:2 /^Planted unmatched\\b/']);
    });

    it('scans every testnet spec and fixture and finds each pattern in packages/core/src', () => {
        const files = targets().map((file) => [path.relative(ROOT, file), fs.readFileSync(file, 'utf8')]);
        const patterns = files.flatMap(([, source]) => collectUiPatterns(source));
        for (const kind of ['getByText', 'getByRole']) {
            expect(patterns.some((pattern) => pattern.kind === kind), `scan found no ${kind} regex`).toBe(true);
        }
        expect(invalidUiPatterns(files, coreSources())).toEqual([]);
    });
});
