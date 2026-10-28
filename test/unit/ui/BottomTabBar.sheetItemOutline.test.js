// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const coreSrc = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src');
const tokensCss = readFileSync(join(coreSrc, 'ui', 'tokens.css'), 'utf8');
const moduleCss = readFileSync(join(coreSrc, 'shared', 'components', 'BottomTabBar.module.css'), 'utf8');
const tokensRoot = postcss.parse(tokensCss);
const moduleRoot = postcss.parse(moduleCss);
const actionsRoot = postcss.parse(readFileSync(join(coreSrc, 'shared', 'routes', 'ActionsMenu.module.css'), 'utf8'));

const GLOBAL_RESET = ':root [data-xc-menu-list="rows"] [data-xc-menu-item]';
const HOVER = '.sheetList[data-xc-menu-list="rows"] .sheetItem[data-xc-menu-item]:hover';
const REST = '.sheetList[data-xc-menu-list="rows"] .sheetItem[data-xc-menu-item]';
const FOCUS = '.sheetList[data-xc-menu-list="rows"] .sheetItem[data-xc-menu-item]:focus-visible';

function ruleFor(root, selector) {
    let found;
    root.walkRules((rule) => {
        if (!found && rule.selectors.includes(selector)) found = rule;
    });
    return found;
}

function declarations(rule) {
    return Object.fromEntries((rule?.nodes ?? [])
        .filter((node) => node.type === 'decl')
        .map((node) => [node.prop, node.value]));
}

// These selectors contain no type selectors, so their specificity is the
// number of ids followed by the combined class, attribute and pseudo count.
function specificity(selector) {
    const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
    const classes = selector.match(/\.[\w-]+/g)?.length ?? 0;
    const attributes = selector.match(/\[[^\]]+\]/g)?.length ?? 0;
    const pseudos = selector.match(/:(?!:)[\w-]+/g)?.length ?? 0;
    return [ids, classes + attributes + pseudos, 0];
}

describe('More sheet row outline', () => {
    it('leaves outline available above the global rows-menu border reset', () => {
        const reset = ruleFor(tokensRoot, GLOBAL_RESET);
        expect(reset).toBeTruthy();
        expect(specificity(GLOBAL_RESET)).toEqual([0, 3, 0]);
        expect(declarations(reset)).toMatchObject({ border: '0' });
        expect(Object.keys(declarations(reset))).not.toContain('outline');
    });

    it('draws a 1px control border on hover above the reset', () => {
        const rest = ruleFor(moduleRoot, REST);
        const hover = ruleFor(moduleRoot, HOVER);
        expect(declarations(rest)).toMatchObject({ border: '1px solid transparent' });
        expect(declarations(hover)).toMatchObject({ 'border-color': 'var(--xc-control-border)' });
        expect(specificity(REST)[1]).toBeGreaterThan(specificity(GLOBAL_RESET)[1]);
        expect(specificity(HOVER)[1]).toBeGreaterThan(specificity(GLOBAL_RESET)[1]);
    });

    it('draws the same 1px border on an actions menu entry', () => {
        const cardRoot = postcss.parse(readFileSync(join(coreSrc, 'ui', 'Card.module.css'), 'utf8'));
        const entry = ':root [data-xc-menu-list="cards"] li > .card';
        const rows = ':root [data-xc-menu-list="rows"] li > .card';
        const hover = ':root [data-xc-menu-list] li > .entry:hover:not([aria-disabled="true"])';
        expect(declarations(ruleFor(cardRoot, rows))).toMatchObject({ border: '1px solid transparent' });
        expect(specificity(rows)[1]).toBeGreaterThan(specificity(GLOBAL_RESET)[1] - 1);
        expect(declarations(ruleFor(cardRoot, entry))).toMatchObject({ border: 'var(--xc-card-border)' });
        expect(specificity(entry)[1]).toBeGreaterThan(specificity(GLOBAL_RESET)[1] - 1);
        expect(declarations(ruleFor(actionsRoot, hover))).toMatchObject({ 'border-color': 'var(--xc-control-border)' });
    });

    it('keeps the inset 2px accent ring on keyboard focus', () => {
        const focus = ruleFor(moduleRoot, FOCUS);
        expect(focus).toBeTruthy();
        expect(declarations(focus)).toMatchObject({
            outline: '2px solid var(--xc-accent-primary, var(--xc-text))',
            'outline-offset': '-2px',
        });
        expect(specificity(FOCUS)[1]).toBeGreaterThan(specificity(GLOBAL_RESET)[1]);
    });

    it('keeps row sizing unchanged across idle, hover and focus states', () => {
        const sizingDeclarations = [];
        moduleRoot.walkRules((rule) => {
            if (!rule.selector.includes('[data-xc-menu-list="rows"]') || !rule.selector.includes('[data-xc-menu-item]')) return;
            rule.walkDecls(/^(?:padding|margin|border-width)(?:-|$)/, (decl) => sizingDeclarations.push(decl.toString()));
        });
        expect(sizingDeclarations).toEqual([]);
    });

    it('uses the system selection colour for the hover border and focus ring in forced colors', () => {
        let forcedColors;
        moduleRoot.walkAtRules('media', (rule) => {
            if (rule.params === '(forced-colors: active)') forcedColors = rule;
        });
        expect(forcedColors).toBeTruthy();
        expect(declarations(ruleFor(forcedColors, HOVER))).toMatchObject({ 'border-color': 'Highlight' });
        expect(declarations(ruleFor(forcedColors, FOCUS))).toMatchObject({ 'outline-color': 'Highlight' });
    });
});
