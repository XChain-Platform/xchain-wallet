// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/BetFeedsList.module.css', 'utf8');
const jsx = readFileSync('packages/core/src/shared/routes/BetFeedsList.jsx', 'utf8');

describe('Prediction markets list spacing (8px between every block)', () => {
    it('takes the 8px gap from ListPage itself, with no local override', () => {
        const listPage = readFileSync('packages/core/src/ui/ListPage.module.css', 'utf8');
        expect(listPage).toMatch(/\.page\s*\{[^}]*--xc-list-page-gap:\s*var\(--xc-space-2\)[^}]*gap:\s*var\(--xc-list-page-gap\)/s);
        expect(css).not.toMatch(/--xc-section-gap/);
        expect(jsx).not.toMatch(/<ListPage\s+className=/);
    });

    it('spaces the market cards 8px apart', () => {
        expect(css).toMatch(/\.marketList\s*\{[^}]*gap:\s*var\(--xc-space-2\)/s);
    });

    it('lays the cards in an auto-fill grid: one full-width card on a phone, side by side when wide', () => {
        const rule = css.match(/\.marketList\s*\{[^}]*\}/s)?.[0] ?? '';
        // min(100%, ...) keeps one card spanning a phone or the popup.
        expect(rule).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/);
        const floor = Number(rule.match(/min\(100%,\s*(\d+)px\)/)[1]);
        // A card never grows past about 440px once two share a row: the widest
        // two-column track is just before a third column fits.
        const widestTwoColumn = ((3 * floor + 2 * 8 - 1) - 8) / 2;
        expect(widestTwoColumn).toBeLessThanOrEqual(440);
        expect(floor).toBeGreaterThanOrEqual(280);
        expect(css).toMatch(/\.marketList > \*\s*\{[^}]*max-width:\s*440px/s);
    });

    it('gives My bets and My markets the same grid as All', () => {
        // One list for every tab: the tabs filter the rows, never the markup.
        const grids = jsx.match(/<ul className=\{local\.marketList\}[^>]*>/g) ?? [];
        expect(grids).toEqual(['<ul className={local.marketList} aria-label="Prediction markets" data-xc-split-list={twoPanel ? \'\' : undefined}>']);
        expect(jsx).not.toMatch(/listClassName=|aria-label="Your prediction markets"/);
        expect(jsx).not.toMatch(/<OracleConsole\b/);
    });

    it('adds no margin or larger gap between the tabs row and the list', () => {
        const rule = (name) => css.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`, 's'))?.[0] ?? '';
        for (const name of ['toolbarRow', 'cardArea', 'marketList']) {
            expect(rule(name)).not.toMatch(/margin(-block|-top|-bottom)?:\s*[^0\s]/);
        }
    });
});
