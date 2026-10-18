// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const surfaces = [
    {
        file: 'packages/core/src/ui/Button.module.css',
        base: '.btn',
        hoverSelectors: ['.btn:hover', '.danger:hover', '.success:hover'],
        hoverBackground: 'var(--xc-button-hover-bg)',
        selectedSelector: "[aria-pressed='true']",
    },
    {
        file: 'packages/core/src/ui/Chip.module.css',
        base: '.toggle',
        hoverSelectors: ['.toggle:hover'],
        hoverBackground: 'var(--xc-control-bg-hover)',
        selectedSelector: '.pressed',
    },
    {
        file: 'packages/core/src/ui/Tabs.module.css',
        base: '.tab',
        hoverSelectors: ['.tab:hover'],
        hoverBackground: 'var(--xc-control-bg-hover)',
        selectedSelector: "[aria-selected='true']",
    },
    {
        file: 'packages/core/src/ui/ListRow.module.css',
        base: '.interactive',
        hoverSelectors: ['.interactive:hover'],
        hoverBackground: 'var(--xc-control-bg-hover)',
        selectedSelector: "[aria-current='page']",
    },
    {
        file: 'packages/core/src/shared/routes/ActionsMenu.module.css',
        base: '.entry',
        hoverSelectors: ['.entry:hover'],
        hoverBackground: 'var(--xc-control-bg-hover)',
        selectedSelector: "[aria-current='page']",
    },
    {
        file: 'packages/core/src/shared/components/CollectiblesView.module.css',
        base: '.cardClickable',
        hoverSelectors: ['.cardClickable:hover'],
        hoverBackground: 'var(--xc-control-bg-hover)',
        selectedSelector: '.cardPinned',
    },
];

function declarations(rule) {
    return Object.fromEntries(rule.nodes
        .filter((node) => node.type === 'decl')
        .map((node) => [node.prop, node.value]));
}

function hasFinePointerGate(rule) {
    for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
        if (parent.type === 'atrule'
            && parent.name === 'media'
            && parent.params === '(hover: hover) and (pointer: fine)') return true;
    }
    return false;
}

function inspectSurface(source, surface) {
    const root = postcss.parse(source, { from: surface.file });
    const rules = [];
    root.walkRules((rule) => rules.push(rule));
    const failures = [];
    const baseRule = rules.find((rule) => rule.selectors.includes(surface.base));
    if (declarations(baseRule || { nodes: [] }).cursor !== 'pointer') {
        failures.push('interactive surface needs pointer cursor');
    }

    const hoverRules = rules.filter((rule) => surface.hoverSelectors.some(
        (selector) => rule.selectors.some((candidate) => candidate.includes(selector)),
    ));
    if (hoverRules.length === 0 || hoverRules.some((rule) => !hasFinePointerGate(rule))) {
        failures.push('hover must require a fine pointer');
    }
    const hoverBackgrounds = hoverRules
        .map((rule) => declarations(rule).background)
        .filter(Boolean);
    if (hoverBackgrounds.length !== 1 || hoverBackgrounds[0] !== surface.hoverBackground) {
        failures.push('hover must use one surface background token');
    }

    const activeRules = rules.filter((rule) => rule.selectors.some(
        (selector) => selector.includes(`${surface.base}:active`),
    ));
    if (!activeRules.some((rule) => declarations(rule).background)) {
        failures.push('pressed state needs a background');
    }

    const selectedRules = rules.filter((rule) => rule.selectors.some(
        (selector) => selector.includes(surface.selectedSelector),
    ));
    const selectedDeclarations = selectedRules.flatMap((rule) => Object.values(declarations(rule)));
    if (!selectedDeclarations.some((value) => value.includes('--xc-control-selected'))) {
        failures.push('selected state needs the shared selected token');
    }
    return failures;
}

describe('desktop interactive surface states', () => {
    it.each(surfaces)('$file has consistent hover, pressed, selected, and cursor states', (surface) => {
        const source = readFileSync(surface.file, 'utf8');
        expect(inspectSurface(source, surface)).toEqual([]);
    });

    it('rejects touch hover leakage and incomplete state styling', () => {
        const source = [
            '.item { cursor: auto; }',
            '.item:hover { background: var(--xc-control-bg-hover); }',
            '.item:active { color: var(--xc-text); }',
            ".item[aria-selected='true'] { color: var(--xc-text); }",
        ].join('\n');
        const failures = inspectSurface(source, {
            file: 'Fixture.module.css',
            base: '.item',
            hoverSelectors: ['.item:hover'],
            hoverBackground: 'var(--xc-control-bg-hover)',
            selectedSelector: "[aria-selected='true']",
        });

        expect(failures).toEqual([
            'interactive surface needs pointer cursor',
            'hover must require a fine pointer',
            'pressed state needs a background',
            'selected state needs the shared selected token',
        ]);
    });
});
