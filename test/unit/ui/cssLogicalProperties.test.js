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

const physicalDeclarationAllowlist = new Set([
    'packages/core/src/shared/components/BalanceList.module.css|.amountFitInner|transform-origin|right center',
    'packages/core/src/shared/routes/TokenDetail.module.css|.balanceHeroAmountFitInner|transform-origin|left center',
]);

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

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function quadValues(values) {
    if (values.length === 1) return [values[0], values[0], values[0], values[0]];
    if (values.length === 2) return [values[0], values[1], values[0], values[1]];
    if (values.length === 3) return [values[0], values[1], values[2], values[1]];
    return values;
}

function hasPhysicalInlineShorthand(property, value) {
    const values = postcss.list.space(value);
    if ((property === 'margin' || property === 'padding') && values.length === 4) {
        return values[1] !== values[3];
    }
    if (property !== 'border-radius') return false;

    return value.split('/').some((part) => {
        const corners = quadValues(postcss.list.space(part.trim()));
        return corners.length === 4
            && (corners[0] !== corners[1] || corners[3] !== corners[2]);
    });
}

function allowlistKey(declaration, from, property, value) {
    const file = from.startsWith(process.cwd()) ? relative(process.cwd(), from) : from;
    return `${file}|${declaration.parent.selector}|${property}|${value}`;
}

function physicalDeclarations(source, from = 'Fixture.module.css', { checkShorthands = true } = {}) {
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = declaration.value.trim().toLowerCase();
        const isPhysical = physicalProperties.has(property)
            || (property === 'text-align' && /^(?:left|right)$/.test(value))
            || (property === 'transform-origin' && /\b(?:left|right)\b/.test(value))
            || (checkShorthands && hasPhysicalInlineShorthand(property, value));
        if (isPhysical
            && !physicalDeclarationAllowlist.has(allowlistKey(declaration, from, property, value))) {
            findings.push({
                property,
                value,
                line: declaration.source.start.line,
            });
        }
    });
    return findings;
}

function declarationsFor(moduleName, selector) {
    const file = join(coreSource, 'shared', 'routes', `${moduleName}.module.css`);
    const declarations = {};
    postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkRules((rule) => {
        if (rule.selector !== selector) return;
        rule.walkDecls((declaration) => {
            declarations[declaration.prop] = declaration.value;
        });
    });
    return declarations;
}

describe('core CSS module logical properties', () => {
    it('detects physical inline-axis declarations regardless of formatting', () => {
        const source = [
            '.a { margin-left: 1rem; right: 0; }',
            '.b { text-align: right; border-top-left-radius: 2px; }',
            '.c { margin: 0 1rem 0 2rem; border-radius: 1rem 0 0 1rem; }',
            '.d { transform-origin: right center; }',
        ].join('\n');

        expect(physicalDeclarations(source)).toEqual([
            { property: 'margin-left', value: '1rem', line: 1 },
            { property: 'right', value: '0', line: 1 },
            { property: 'text-align', value: 'right', line: 2 },
            { property: 'border-top-left-radius', value: '2px', line: 2 },
            { property: 'margin', value: '0 1rem 0 2rem', line: 3 },
            { property: 'border-radius', value: '1rem 0 0 1rem', line: 3 },
            { property: 'transform-origin', value: 'right center', line: 4 },
        ]);
    });

    it('allows an exact physical declaration when LTR content requires it', () => {
        const file = join(coreSource, 'shared', 'routes', 'TokenDetail.module.css');
        const allowed = '.balanceHeroAmountFitInner { transform-origin: left center; }';
        const unexpected = '.anotherAmount { transform-origin: left center; }';

        expect(physicalDeclarations(allowed, file)).toEqual([]);
        expect(physicalDeclarations(unexpected, file)).toEqual([
            { property: 'transform-origin', value: 'left center', line: 1 },
        ]);
    });

    it('mirrors route-owned directional visuals and isolates machine-readable values', () => {
        expect(declarationsFor('MarketActivity', ":global([dir='rtl']) .marketSelectorChevron"))
            .toMatchObject({ transform: 'scaleX(-1)' });
        expect(declarationsFor('MySwapsView', ":global([dir='rtl']) .side + .side::before"))
            .toMatchObject({ transform: 'scaleX(-1)' });
        expect(declarationsFor('OnboardingCarousel', ":global([dir='rtl']) .frame"))
            .toMatchObject({ '--xc-frame-enter-offset': '-16px' });

        for (const [moduleName, selector] of [
            ['ManageToken', '.heroOwner'],
            ['MySwapsView', '.side'],
            ['StakeDetail', '.eventAmount'],
            ['StakingList', '.amount'],
            ['TokenDetail', '.balanceHeroAmount'],
            ['ViewPrivateKey', '.wif'],
        ]) {
            expect(declarationsFor(moduleName, selector)).toMatchObject({
                direction: 'ltr',
                'unicode-bidi': 'isolate',
            });
        }
    });

    it('uses logical inline-axis declarations throughout core CSS modules', () => {
        const modules = cssModules(coreSource);
        const findings = modules.flatMap((file) => (
            physicalDeclarations(readFileSync(file, 'utf8'), file, {
                checkShorthands: /\/shared\/routes\/[M-Z][^/]*\.module\.css$/.test(file),
            }).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));

        expect(modules.length).toBeGreaterThan(0);
        expect(findings).toEqual([]);
    });
});
