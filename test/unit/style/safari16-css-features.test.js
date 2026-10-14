// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cachedSourceFiles } from '../../helpers/sourceScan.js';
import baseline from './safari16-css-features.baseline.json';

const packagesRoot = join(process.cwd(), 'packages');
const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');
const COLOR_MIX = /color-mix\s*\(/i;
const TEXT_WRAP = /^(?:balance|pretty)$/i;
const DVH = /(^|[^\w-])(?:\d*\.)?\d+dvh(?![\w-])/i;
const VH = /(^|[^\w-])(?:\d*\.)?\d+vh(?![\w-])/i;
const SUBGRID = /(^|\s)subgrid(?:\s|$)/i;
const FEATURE_NAMES = [
    ':has()',
    'native CSS nesting',
    '@container style query',
    'color-mix()',
    'text-wrap: balance',
    'text-wrap: pretty',
    'dvh unit',
    'subgrid',
];

function ancestors(node) {
    const result = [];
    for (let parent = node.parent; parent; parent = parent.parent) result.push(parent);
    return result;
}

function hasSupportsGuard(node, pattern) {
    return ancestors(node).some((parent) => (
        parent.type === 'atrule'
        && parent.name.toLowerCase() === 'supports'
        && pattern.test(parent.params)
    ));
}

function hasEarlierFallback(declaration, isFallback) {
    for (let sibling = declaration.prev(); sibling; sibling = sibling.prev()) {
        if (sibling.type !== 'decl' || sibling.prop.toLowerCase() !== declaration.prop.toLowerCase()) {
            continue;
        }
        if (isFallback(sibling.value)) return true;
    }
    return false;
}

function addIssue(issues, node, feature, detail) {
    issues.push({
        feature,
        line: node.source?.start?.line ?? 1,
        detail,
    });
}

function scanCss(source, from = 'fixture.css') {
    const root = postcss.parse(source, { from });
    const issues = [];

    root.walkDecls((declaration) => {
        if (COLOR_MIX.test(declaration.value)
            && !hasEarlierFallback(declaration, (value) => !COLOR_MIX.test(value))) {
            addIssue(issues, declaration, 'color-mix()', declaration.prop);
        }

        if (declaration.prop.toLowerCase() === 'text-wrap' && TEXT_WRAP.test(declaration.value.trim())) {
            const value = declaration.value.trim().toLowerCase();
            if (!hasEarlierFallback(declaration, (candidate) => !TEXT_WRAP.test(candidate.trim()))) {
                addIssue(issues, declaration, `text-wrap: ${value}`, declaration.prop);
            }
        }

        if (DVH.test(declaration.value)
            && !hasEarlierFallback(declaration, (value) => VH.test(value))) {
            addIssue(issues, declaration, 'dvh unit', declaration.prop);
        }

        if (SUBGRID.test(declaration.value)
            && !hasEarlierFallback(declaration, (value) => !SUBGRID.test(value))) {
            addIssue(issues, declaration, 'subgrid', declaration.prop);
        }
    });

    root.walkRules((rule) => {
        if (/:has\s*\(/i.test(rule.selector)
            && !hasSupportsGuard(rule, /selector\s*\([^)]*:has\s*\(/i)) {
            addIssue(issues, rule, ':has()', rule.selector);
        }

        if (ancestors(rule).some((parent) => parent.type === 'rule')
            && !hasSupportsGuard(rule, /selector\s*\(\s*&/i)) {
            addIssue(issues, rule, 'native CSS nesting', rule.selector);
        }
    });

    root.walkAtRules((atRule) => {
        if (atRule.name.toLowerCase() === 'container' && /\bstyle\s*\(/i.test(atRule.params)) {
            addIssue(issues, atRule, '@container style query', atRule.params);
        }

        if (ancestors(atRule).some((parent) => parent.type === 'rule')
            && !hasSupportsGuard(atRule, /selector\s*\(\s*&/i)) {
            addIssue(issues, atRule, 'native CSS nesting', `@${atRule.name} ${atRule.params}`);
        }
    });

    return issues.sort((left, right) => left.line - right.line
        || left.feature.localeCompare(right.feature));
}

// Build output (vite dist, the mobile www copy) and installed packages are not
// source; a local build must not change what the guard counts.
// Capacitor's `cap sync` copies www into the native projects; those gitignored
// copies are build output like www itself.
const GENERATED_DIR = /(?:^|\/)(?:node_modules|dist|www|ios\/App\/App\/public|android\/app\/src\/main\/assets\/public)\//;

function scanPackages() {
    return cachedSourceFiles(packagesRoot, '**/*.css')
        .filter((file) => !GENERATED_DIR.test(file.relativePath.split('\\').join('/')))
        .flatMap((file) => (
            scanCss(file.source, file.path).map((issue) => ({
                ...issue,
                file: `packages/${file.relativePath}`,
            }))
        ));
}

function countByFeature(issues) {
    return Object.fromEntries(FEATURE_NAMES.map((feature) => [
        feature,
        issues.filter((issue) => issue.feature === feature).length,
    ]));
}

describe('Safari 16 CSS feature scanner', () => {
    it('detects every unsupported feature without its required fallback or guard', () => {
        const issues = scanCss(`
            .card:has(img) { display: block; }
            .parent { & .child { display: block; } }
            @container card style(--theme: dark) { .themed { color: red; } }
            .mix { color: color-mix(in srgb, red, blue); }
            .balanced { text-wrap: balance; }
            .pretty { text-wrap: pretty; }
            .viewport { min-height: 100dvh; }
            .grid { grid-template-columns: subgrid; }
        `);

        expect(issues.map(({ feature }) => feature)).toEqual(FEATURE_NAMES);
    });

    it('accepts same-rule fallbacks and matching feature guards', () => {
        const issues = scanCss(`
            @supports selector(:has(*)) { .card:has(img) { display: block; } }
            @supports selector(&) { .parent { & .child { display: block; } } }
            .mix { color: red; color: color-mix(in srgb, red, blue); }
            .balanced { text-wrap: wrap; text-wrap: balance; }
            .pretty { text-wrap: wrap; text-wrap: pretty; }
            .viewport { min-height: 100vh; min-height: 100dvh; }
            .grid { grid-template-columns: 1fr; grid-template-columns: subgrid; }
        `);

        expect(issues).toEqual([]);
    });

    it('does not exceed the checked-in offender baseline', () => {
        const issues = scanPackages();
        const counts = countByFeature(issues);

        expect(Object.keys(baseline)).toEqual(FEATURE_NAMES);
        for (const feature of FEATURE_NAMES) {
            const offenders = issues.filter((issue) => issue.feature === feature);
            const locations = offenders
                .map((issue) => `${issue.file}:${issue.line} (${issue.detail})`)
                .join('\n');

            expect(
                counts[feature],
                `New ${feature} offenders exceed the baseline:\n${locations}`,
            ).toBeLessThanOrEqual(baseline[feature]);
        }
    });
});
