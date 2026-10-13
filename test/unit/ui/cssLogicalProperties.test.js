// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoots = [
    join(process.cwd(), 'packages', 'core', 'src'),
    join(process.cwd(), 'packages', 'extension', 'src'),
    join(process.cwd(), 'packages', 'desktop', 'renderer'),
    join(process.cwd(), 'packages', 'web', 'src'),
];
const shellSourceRoots = sourceRoots.slice(1);
const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const physicalProperties = new Set([
    'margin-left',
    'margin-right',
    'padding-left',
    'padding-right',
    'left',
    'right',
    'border-left',
    'border-left-color',
    'border-left-style',
    'border-left-width',
    'border-right',
    'border-right-color',
    'border-right-style',
    'border-right-width',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
]);

const allowedPhysicalDeclarations = new Set([
    'packages/core/src/ui/tokens.css|body|padding-left|env(safe-area-inset-left, 0)',
    'packages/core/src/ui/tokens.css|body|padding-right|env(safe-area-inset-right, 0)',
    'packages/web/src/style-guide/style-guide.css|.sg-example-wide|left|50%',
]);
const allowedPhysicalInlineStyles = new Set([
    'packages/web/src/DevVariantBadge.jsx|left|`${pos.x}px`',
    "packages/web/src/DevVariantBadge.jsx|right|'auto'",
]);

function cssFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssFiles(path);
        return entry.name.endsWith('.css') ? [path] : [];
    });
}

function scriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return scriptFiles(path);
        return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

function physicalInlineStyles(source) {
    const findings = [];
    const property = [
        '(?:margin|padding|border)(?:Left|Right)',
        'border(?:Top|Bottom)(?:Left|Right)Radius',
        'left',
        'right',
        'textAlign',
    ].join('|');
    const pattern = new RegExp(`(?:^|[,{])\\s*(${property})\\s*:\\s*([^,\\n]+)`, 'g');
    for (const match of source.matchAll(pattern)) {
        if (match[1] === 'textAlign' && !/^["'](?:left|right)["']$/.test(match[2].trim())) continue;
        findings.push({ property: match[1], value: match[2].trim() });
    }
    return findings;
}

function physicalDeclarations(source, from = 'Fixture.module.css') {
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = declaration.value.trim().toLowerCase();
        if (physicalProperties.has(property)
            || (property === 'text-align' && /^(?:left|right)$/.test(value))) {
            findings.push({
                selector: declaration.parent.selector,
                property,
                value,
                line: declaration.source.start.line,
            });
        }
    });
    return findings;
}

function allowanceKey(finding) {
    return `${finding.file}|${finding.selector}|${finding.property}|${finding.value}`;
}

describe('wallet CSS logical properties', () => {
    it('detects physical inline-axis declarations regardless of formatting', () => {
        const source = [
            '.a { margin-left: 1rem; right: 0; }',
            '.b { text-align: right; border-top-left-radius: 2px; }',
        ].join('\n');

        expect(physicalDeclarations(source)).toEqual([
            { selector: '.a', property: 'margin-left', value: '1rem', line: 1 },
            { selector: '.a', property: 'right', value: '0', line: 1 },
            { selector: '.b', property: 'text-align', value: 'right', line: 2 },
            { selector: '.b', property: 'border-top-left-radius', value: '2px', line: 2 },
        ]);
    });

    it('uses logical inline-axis declarations throughout wallet CSS', () => {
        const files = sourceRoots.flatMap(cssFiles);
        const scripts = shellSourceRoots.flatMap(scriptFiles);
        const findings = files.flatMap((file) => (
            physicalDeclarations(readFileSync(file, 'utf8'), file).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));
        const allowedFindings = findings.filter((finding) => (
            allowedPhysicalDeclarations.has(allowanceKey(finding))
        ));
        const violations = findings.filter((finding) => (
            !allowedPhysicalDeclarations.has(allowanceKey(finding))
        ));
        const inlineFindings = scripts.flatMap((file) => (
            physicalInlineStyles(readFileSync(file, 'utf8')).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));
        const inlineKey = (finding) => `${finding.file}|${finding.property}|${finding.value}`;
        const allowedInlineFindings = inlineFindings.filter((finding) => (
            allowedPhysicalInlineStyles.has(inlineKey(finding))
        ));
        const inlineViolations = inlineFindings.filter((finding) => (
            !allowedPhysicalInlineStyles.has(inlineKey(finding))
        ));

        expect(files.length).toBeGreaterThan(0);
        expect(new Set(allowedFindings.map(allowanceKey))).toEqual(allowedPhysicalDeclarations);
        expect(violations).toEqual([]);
        expect(new Set(allowedInlineFindings.map(inlineKey))).toEqual(allowedPhysicalInlineStyles);
        expect(inlineViolations).toEqual([]);
    });

    it('mirrors shell affordances and isolates machine-readable values', () => {
        const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
        const assetCard = read('packages/web/src/style-guide/sections/AssetCardSection.module.css');
        const balances = read('packages/web/src/style-guide/sections/BalanceListSection.module.css');
        const tokenSelector = read('packages/web/src/style-guide/sections/TokenSelectorSection.module.css');
        const addresses = read('packages/web/src/style-guide/sections/AddressListSection.module.css');
        const badge = read('packages/web/src/DevVariantBadge.module.css');
        const shell = read('packages/web/src/DevVariantShell.module.css');
        const approval = read('packages/extension/src/approval/kinds/SignApproval.jsx');

        expect(assetCard).toMatch(/\.chevron:dir\(rtl\)[^{]*\{[^}]*transform:\s*scaleX\(-1\)/s);
        expect(balances).toMatch(/\.amounts\s*\{[^}]*direction:\s*ltr[^}]*unicode-bidi:\s*isolate/s);
        expect(tokenSelector).toMatch(/\.amounts\s*\{[^}]*direction:\s*ltr[^}]*unicode-bidi:\s*isolate/s);
        expect(addresses).toMatch(/\.abAddr\s*\{[^}]*direction:\s*ltr[^}]*unicode-bidi:\s*isolate/s);
        expect(badge).toMatch(/\.badge:dir\(rtl\)[^{]*\{[^}]*safe-area-inset-right/s);
        expect(badge).toMatch(/\.picker:dir\(rtl\)[^{]*\{[^}]*background-position:\s*left/s);
        expect(shell).toMatch(/\.sidebarFrame:dir\(rtl\)[^{]*\{[^}]*box-shadow:\s*16px/s);
        expect(approval.match(/dir="ltr"/g)).toHaveLength(3);
    });
});
