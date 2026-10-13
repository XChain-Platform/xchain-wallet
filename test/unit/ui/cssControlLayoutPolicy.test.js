// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const packagesRoot = join(repoRoot, 'packages');
const allowlistPath = join(repoRoot, 'test/unit/ui/cssControlLayoutPolicy.allowlist.json');
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const controlWords = new Set([
    'button', 'buttons',
    'input', 'inputs',
    'select', 'selects',
    'field', 'fields',
    'picker', 'pickers',
    'chip', 'chips',
    'tab', 'tabs',
]);

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function splitSelectorList(selector) {
    const selectors = [];
    let start = 0;
    let depth = 0;
    let quote = '';

    for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index];
        if (quote) {
            if (character === quote && selector[index - 1] !== '\\') quote = '';
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '(' || character === '[') {
            depth += 1;
        } else if (character === ')' || character === ']') {
            depth -= 1;
        } else if (character === ',' && depth === 0) {
            selectors.push(selector.slice(start, index).trim());
            start = index + 1;
        }
    }

    selectors.push(selector.slice(start).trim());
    return selectors;
}

function subjectCompound(selector) {
    let start = 0;
    let depth = 0;
    let quote = '';

    for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index];
        if (quote) {
            if (character === quote && selector[index - 1] !== '\\') quote = '';
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '(' || character === '[') {
            depth += 1;
        } else if (character === ')' || character === ']') {
            depth -= 1;
        } else if (depth === 0 && /[>+~\s]/.test(character)) {
            start = index + 1;
        }
    }

    return selector.slice(start).trim();
}

function classNames(selector) {
    return [...subjectCompound(selector).matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)]
        .map((match) => match[1]);
}

function nameWords(className) {
    return className
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .split(/[-_]/)
        .map((word) => word.toLowerCase())
        .filter(Boolean);
}

function isControlClass(className) {
    const words = nameWords(className);
    return words.some((word) => controlWords.has(word))
        || words.some((word) => [...controlWords].some((control) => word.endsWith(control)));
}

function isRouteRootClass(file, className) {
    if (!file.split(/[\\/]/).includes('routes')) return false;
    const words = nameWords(className);
    return words.includes('root') || (words.length === 1 && words[0] === 'page');
}

function normalized(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function layoutFindings(source, file = 'packages/Fixture.module.css') {
    const findings = [];
    postcss.parse(source, { from: file }).walkRules((rule) => {
        for (const selector of splitSelectorList(rule.selector)) {
            const classes = classNames(selector);
            const controlClass = classes.some(isControlClass);
            const routeRootClass = classes.some((className) => isRouteRootClass(file, className));
            if (!controlClass && !routeRootClass) continue;

            rule.each((node) => {
                if (node.type !== 'decl') return;
                const property = node.prop.toLowerCase();
                const rawPixelControlHeight = controlClass
                    && (property === 'height' || property === 'min-height')
                    && /(^|[^\w.])(?:\d+\.?\d*|\.\d+)px\b/i.test(node.value);
                const routeRootSpacing = routeRootClass && /^(?:padding|margin)(?:-|$)/.test(property);
                if (!rawPixelControlHeight && !routeRootSpacing) return;

                findings.push({
                    key: `${file} | ${normalized(selector)} | ${property}: ${normalized(node.value)}`,
                    line: node.source.start.line,
                });
            });
        }
    });
    return findings;
}

describe('CSS control and route-root layout policy', () => {
    it('finds policy violations on selector subjects without flagging descendants', () => {
        const source = [
            '.primaryButton { height: 40px; }',
            '.primaryButton svg { height: 16px; }',
            '.amountField:hover { min-height: calc(44px + 0.1rem); }',
            '.dataTable { height: 20px; }',
            '.pageTitle { margin-block: 1rem; }',
            '.rootFull { padding-inline: var(--xc-page-gutter); }',
        ].join('\n');

        expect(layoutFindings(source, 'packages/core/src/shared/routes/Fixture.module.css'))
            .toEqual([
                {
                    key: 'packages/core/src/shared/routes/Fixture.module.css | .primaryButton | height: 40px',
                    line: 1,
                },
                {
                    key: 'packages/core/src/shared/routes/Fixture.module.css | .amountField:hover | min-height: calc(44px + 0.1rem)',
                    line: 3,
                },
                {
                    key: 'packages/core/src/shared/routes/Fixture.module.css | .rootFull | padding-inline: var(--xc-page-gutter)',
                    line: 6,
                },
            ]);
    });

    it('matches the justified exception baseline across every package CSS module', () => {
        const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
        const modules = cssModules(packagesRoot).sort();
        const findings = modules.flatMap((file) => layoutFindings(
            readFileSync(file, 'utf8'),
            relative(repoRoot, file).split(sep).join('/'),
        ));
        const findingKeys = new Set(findings.map(({ key }) => key));
        const allowlistKeys = new Set(Object.keys(allowlist));
        const unallowlisted = findings
            .filter(({ key }) => !allowlistKeys.has(key))
            .map(({ key, line }) => `${key} (line ${line})`);
        const stale = [...allowlistKeys].filter((key) => !findingKeys.has(key));
        const missingReasons = Object.entries(allowlist)
            .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 12)
            .map(([key]) => key);

        expect(modules.length).toBeGreaterThan(0);
        expect({ unallowlisted, stale, missingReasons }).toEqual({
            unallowlisted: [],
            stale: [],
            missingReasons: [],
        });
    });
});
