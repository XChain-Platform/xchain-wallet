// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreSource = join(process.cwd(), 'packages', 'core', 'src');
const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function normalize(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function ruleScope(rule) {
    const scope = [];
    for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
        const label = parent.type === 'atrule'
            ? `@${parent.name} ${normalize(parent.params)}`
            : normalize(parent.selector);
        scope.unshift(label);
    }
    return scope.join(' > ') || 'root';
}

function duplicateSelectors(source, from = 'Fixture.module.css') {
    const firstLines = new Map();
    const duplicates = [];
    const root = postcss.parse(source, { from });

    root.walkRules((rule) => {
        const selector = normalize(rule.selector);
        const scope = ruleScope(rule);
        const key = `${scope}\0${selector}`;
        const firstLine = firstLines.get(key);
        if (firstLine !== undefined) {
            duplicates.push({ selector, scope, firstLine, line: rule.source.start.line });
        } else {
            firstLines.set(key, rule.source.start.line);
        }
    });

    return duplicates;
}

describe('CSS module selectors', () => {
    it('detects repeated selectors in the same cascade scope', () => {
        const source = [
            '.item { color: red; }',
            '.item { background: white; }',
            '@media (min-width: 40rem) { .item { color: blue; } }',
            '@keyframes enter { from { opacity: 0; } }',
            '@keyframes leave { from { opacity: 1; } }',
        ].join('\n');

        expect(duplicateSelectors(source)).toEqual([
            { selector: '.item', scope: 'root', firstLine: 1, line: 2 },
        ]);
    });

    it('has no repeated selector blocks in core CSS modules', () => {
        const duplicates = cssModules(coreSource).flatMap((file) => (
            duplicateSelectors(readFileSync(file, 'utf8'), file).map((duplicate) => ({
                file: relative(process.cwd(), file),
                ...duplicate,
            }))
        ));

        expect(duplicates).toEqual([]);
    });
});
