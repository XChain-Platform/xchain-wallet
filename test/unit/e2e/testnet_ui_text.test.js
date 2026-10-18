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
//
// Unit: the testnet e2e specs and fixtures wait on UI text through
// getByText('...'). A literal that no file under packages/core/src holds any
// more only fails 120 s into a live testnet pass, after coins are spent. This
// scan reads every testnet spec and fixture, collects each plain string
// literal passed to getByText, and fails naming the file, line and text of
// any literal that appears verbatim in no core source file. Template literals
// and regex arguments are skipped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const E2E = path.join(ROOT, 'test/e2e');
const CORE_SRC = path.join(ROOT, 'packages/core/src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
});

// getByText( then a single or double quoted literal that is the whole first
// argument (followed by a comma or the closing paren).
const CALL = /getByText\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")\s*[,)]/g;

const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

export function collectGetByText(source) {
    const found = [];
    for (const m of source.matchAll(CALL)) {
        const raw = m[1] !== undefined ? m[1] : m[2];
        const line = source.slice(0, m.index).split('\n').length;
        found.push({ line, text: unescape(raw) });
    }
    return found;
}

const targets = () => [
    ...walk(path.join(E2E, 'tests')).filter((f) => f.endsWith('.testnet.spec.js')),
    ...fs.readdirSync(path.join(E2E, 'fixtures'))
        .filter((f) => /^testnet.*\.js$/.test(f))
        .map((f) => path.join(E2E, 'fixtures', f)),
];

const coreSource = () => walk(CORE_SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

export function unknownLiterals(files, haystack) {
    const bad = [];
    for (const [name, source] of files) {
        for (const { line, text } of collectGetByText(source)) {
            if (!haystack.includes(text)) bad.push(`${name}:${line} ${JSON.stringify(text)}`);
        }
    }
    return bad;
}

describe('testnet e2e getByText literals', () => {
    it('collector reports a planted unknown literal and skips a regex argument', () => {
        const sample = [
            "await main.getByText('known text').click();",
            'await main.getByText("planted unknown text", { exact: true });',
            'await main.getByText(/planted regex text/i);',
            'await main.getByText(`planted ${template} text`);',
        ].join('\n');
        expect(collectGetByText(sample)).toEqual([
            { line: 1, text: 'known text' },
            { line: 2, text: 'planted unknown text' },
        ]);
        expect(unknownLiterals([['sample.js', sample]], 'known text here'))
            .toEqual(['sample.js:2 "planted unknown text"']);
    });

    it('every literal in the testnet specs and fixtures appears in packages/core/src', () => {
        const files = targets().map((f) => [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')]);
        const total = files.reduce((n, [, src]) => n + collectGetByText(src).length, 0);
        expect(total, 'scan found no getByText literal').toBeGreaterThan(0);
        expect(unknownLiterals(files, coreSource())).toEqual([]);
    });
});
