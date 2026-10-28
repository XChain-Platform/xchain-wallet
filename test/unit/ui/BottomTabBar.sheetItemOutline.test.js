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

const GLOBAL_RESET = ':root [data-xc-menu-list="rows"] [data-xc-menu-item]';
const HOVER = '.sheetList[data-xc-menu-list="rows"] .sheetItem[data-xc-menu-item]:hover';
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

    it('draws an inset 1px control edge on hover above the reset', () => {
        const hover = ruleFor(moduleRoot, HOVER);
        expect(hover).toBeTruthy();
        expect(declarations(hover)).toMatchObject({
            outline: '1px solid var(--xc-control-border)',
            'outline-offset': '-1px',
        });
        expect(specificity(HOVER)[1]).toBeGreaterThan(specificity(GLOBAL_RESET)[1]);
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
            rule.walkDecls(/^(?:padding|margin|border)(?:-|$)/, (decl) => sizingDeclarations.push(decl.toString()));
        });
        expect(sizingDeclarations).toEqual([]);
    });

    it('uses the system selection colour for hover and focus in forced colors', () => {
        let forcedColors;
        moduleRoot.walkAtRules('media', (rule) => {
            if (rule.params === '(forced-colors: active)') forcedColors = rule;
        });
        expect(forcedColors).toBeTruthy();
        for (const selector of [HOVER, FOCUS]) {
            expect(declarations(ruleFor(forcedColors, selector))).toMatchObject({ 'outline-color': 'Highlight' });
        }
    });
});
