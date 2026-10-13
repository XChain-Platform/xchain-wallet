// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/Settings.module.css', 'utf8');

function extractBlock(source, header) {
    const start = source.indexOf(header);
    const open = source.indexOf('{', start);
    let depth = 1;
    let cursor = open + 1;

    while (depth > 0 && cursor < source.length) {
        if (source[cursor] === '{') depth += 1;
        if (source[cursor] === '}') depth -= 1;
        cursor += 1;
    }

    return { start, end: cursor, body: source.slice(open + 1, cursor - 1) };
}

describe('Settings CSS compatibility', () => {
    it('keeps every relational selector inside its feature query', () => {
        const guarded = extractBlock(css, '@supports selector(:has(a))');

        expect(guarded.start).toBeGreaterThan(-1);
        expect(guarded.body).toContain(':has(');
        expect(css.slice(0, guarded.start) + css.slice(guarded.end)).not.toContain(':has(');
    });

    it('keeps the narrow-screen control layout outside the feature query', () => {
        const guarded = extractBlock(css, '@supports selector(:has(a))');
        const fallback = css.slice(0, guarded.start);

        expect(fallback).toMatch(/\.page :is\([\s\S]*?select,[\s\S]*?input:not/);
        expect(fallback).toContain('flex: 1 1 100% !important;');
        expect(fallback).toContain('width: 100% !important;');
    });
});
