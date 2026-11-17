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
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

// Every list row hovers with the one shared fill, and a selected row in a
// master-detail layout reads like the side menu's active item without a rail.
describe('list row hover and selected styles', () => {
    it('hovers the kit row with the shared hover token only', () => {
        const css = read('packages/core/src/ui/ListRow.module.css');
        const hover = css.slice(css.indexOf('@media (hover: hover)'), css.indexOf('.interactive:active'));
        expect(hover).toMatch(/background:\s*var\(--xc-row-hover-bg\)/);
        expect(hover).not.toMatch(/accent|box-shadow|border|outline/);
    });

    it('gives BalanceList one outer paint layer at narrow and wide widths', () => {
        const source = read('packages/core/src/shared/components/BalanceList.jsx');
        const css = read('packages/core/src/shared/components/BalanceList.module.css');
        const cardCss = read('packages/core/src/ui/Card.module.css');
        const outerHover = css.match(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.row\.row\[data-xc-row-state\]:hover\s*\{([^}]*)\}/);
        const outerSelected = cardCss.match(/:root \[data-xc-row-state\]:is\([\s\S]*?\)\s*\{([^}]*)\}/);
        const innerStates = css.match(/\.row\.row > \.rowContent\.rowContent:is\([\s\S]*?\)\s*\{([^}]*)\}/);

        expect(source).toMatch(/data-xc-row-state=\{clickable \? '' : undefined\}[\s\S]*data-selected=\{selected \? 'true' : undefined\}/);
        expect(source).toMatch(/<ListRow[\s\S]*aria-current=\{selected \? 'true' : undefined\}/);
        expect(outerHover[1]).toMatch(/background:\s*var\(--xc-row-hover-bg\)/);
        expect(css.slice(0, outerHover.index)).not.toMatch(/@media \(min-width:/);
        expect(innerStates[0]).toMatch(/\[aria-current\]:not\(\[aria-current='false'\]\)/);
        expect(innerStates[1]).toMatch(/background:\s*transparent/);

        const selectedLayerBackgrounds = [outerSelected[1], innerStates[1]]
            .map((rule) => rule.match(/background:\s*([^;]+);/)[1]);
        expect(selectedLayerBackgrounds).toEqual(['var(--xc-row-active-bg)', 'transparent']);
        expect(selectedLayerBackgrounds.filter((background) => background !== 'transparent')).toHaveLength(1);
    });

    it('opts every DEX market row into the shared edge-to-edge states', () => {
        const source = read('packages/core/src/shared/routes/MarketsList.jsx');
        const css = read('packages/core/src/shared/routes/MarketsList.module.css');
        expect(source).toMatch(/className=\{marketsStyles\.marketsCard\}\s+data-xc-split-list/);
        expect(source).toMatch(/<ListRow[\s\S]*?data-xc-split-row[\s\S]*?aria-current=\{selected \? 'true' : undefined\}/);
        expect(css).not.toMatch(/\.marketButton[^{}]*(?:hover|active)|:has\(/);
    });

    it('has no DEX-only selected style', () => {
        const source = read('packages/core/src/shared/routes/MarketsList.jsx');
        const css = read('packages/core/src/shared/routes/MarketsList.module.css');
        expect(source).not.toContain('data-selected={selected');
        expect(css).not.toMatch(/\[data-selected=['"]true['"]\]|\[aria-current=['"]true['"]\]/);
        expect(css).not.toMatch(/xc-row-active-bg|xc-shadow-nav-indicator/);
    });

    it('keeps the focus ring to keyboard focus', () => {
        const css = read('packages/core/src/ui/ListRow.module.css');
        expect(css).toMatch(/\.interactive:focus-visible\s*\{/);
        expect(css).not.toMatch(/\.interactive:focus\s*\{/);
        expect(read('packages/core/src/shared/routes/MarketsList.module.css')).not.toMatch(/\.(?:row|marketButton)[^{]*:focus\s*\{/);
    });

    it('marks the selected wide History row with the shared split-list tint', () => {
        const css = read('packages/core/src/shared/routes/History.module.css');
        const rule = css.match(/\n\.row\.row\[data-xc-split-row\]\[aria-current='true'\]\s*\{([^}]*)\}/);
        expect(rule[1]).toMatch(/background:\s*var\(--xc-row-active-bg\)/);
        expect(rule[1]).toMatch(/box-shadow:\s*none/);
    });
});
