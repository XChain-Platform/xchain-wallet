// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readCore = (...parts) => readFileSync(
    join(root, 'packages', 'core', 'src', ...parts),
    'utf8',
);

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('large text layout styles', () => {
    it('defines shared type sizes in root-relative units', () => {
        const tokens = readCore('ui', 'tokens.css');
        const typeTokens = [...tokens.matchAll(/--xc-text-(?:xs|sm|md|lg|xl|2xl):\s*([^;]+);/g)]
            .map((match) => match[1]);

        expect(typeTokens).toHaveLength(6);
        expect(typeTokens.every((value) => /^\d*\.?\d+rem$/.test(value))).toBe(true);
    });

    it('keeps tab labels inside a scalable bar without fixed pixel type', () => {
        const css = readCore('shared', 'components', 'BottomTabBar.module.css');
        const bar = rule(css, '.bar');
        const tab = rule(css, '.tab');
        const label = rule(css, '.tabLabel');

        expect(css).not.toMatch(/font-size:\s*\d*\.?\d+px/);
        expect(bar).toMatch(/min-height:\s*3\.5rem/);
        expect(bar).not.toMatch(/(?:^|\s)height:/);
        expect(tab).toMatch(/min-width:\s*0/);
        expect(label).toMatch(/text-overflow:\s*ellipsis/);
        expect(label).toMatch(/white-space:\s*nowrap/);
    });

    it('keeps header titles and menu rows from entering adjacent controls', () => {
        const appHeader = readCore('shared', 'components', 'AppHeader.module.css');
        const pageHeader = readCore('ui', 'PageHeader.module.css');
        const networkButton = readCore('shared', 'components', 'HeaderNetworkButton.module.css');

        expect(`${appHeader}\n${pageHeader}`)
            .not.toMatch(/font-size:\s*\d*\.?\d+px/);
        expect(rule(appHeader, '.left')).toMatch(/overflow:\s*hidden/);
        expect(rule(pageHeader, '.title')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(pageHeader, '.title')).toMatch(/white-space:\s*nowrap/);
        expect(rule(networkButton, '.networkSelectLabel')).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('truncates button labels and balance names without icon shrinkage', () => {
        const button = readCore('ui', 'Button.module.css');
        const balances = readCore('shared', 'components', 'BalanceList.module.css');

        expect(rule(button, '.btn')).toMatch(/max-width:\s*100%/);
        expect(rule(button, '.label')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(balances, '.name')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(balances, '.name')).toMatch(/min-width:\s*0/);
        expect(rule(balances, '.iconWrap')).toMatch(/flex:\s*0 0 auto/);
        expect(balances).not.toMatch(/font-size:\s*\d*\.?\d+px/);
    });
});
