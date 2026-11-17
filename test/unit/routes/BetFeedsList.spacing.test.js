// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/BetFeedsList.module.css', 'utf8');
const jsx = readFileSync('packages/core/src/shared/routes/BetFeedsList.jsx', 'utf8');
const shared = readFileSync('packages/core/src/shared/components/QuestionList.module.css', 'utf8');

describe('Prediction markets list spacing (8px between every block)', () => {
    it('takes the 8px gap from ListPage itself, with no local override', () => {
        const listPage = readFileSync('packages/core/src/ui/ListPage.module.css', 'utf8');
        expect(listPage).toMatch(/\.page\s*\{[^}]*--xc-list-page-gap:\s*var\(--xc-space-2\)[^}]*gap:\s*var\(--xc-list-page-gap\)/s);
        expect(css).not.toMatch(/--xc-section-gap/);
        expect(jsx).not.toMatch(/<ListPage\s+className=/);
    });

    it('uses one framed list with full-width separators', () => {
        expect(shared).toMatch(/\.panel\s*\{[^}]*composes:\s*flush/s);
        expect(shared).toMatch(/\.list > li \+ li\s*\{[^}]*border-top:\s*1px solid var\(--xc-border\)/s);
    });

    it('keeps every question row full width at every viewport', () => {
        expect(shared).toMatch(/\.row\s*\{[^}]*width:\s*100%/s);
        expect(shared).not.toMatch(/grid-template-columns|@container/);
    });

    it('gives My bets and My markets the same shared list as All', () => {
        // One list for every tab: the tabs filter the rows, never the markup.
        expect(jsx.match(/<QuestionList label="Prediction markets"/g)).toHaveLength(2);
        expect(jsx).not.toMatch(/listClassName=|aria-label="Your prediction markets"/);
        expect(jsx).not.toMatch(/<OracleConsole\b/);
    });

    it('adds no margin or larger gap between the tabs row and the list', () => {
        const rule = (name) => css.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`, 's'))?.[0] ?? '';
        for (const name of ['toolbarRow']) {
            expect(rule(name)).not.toMatch(/margin(-block|-top|-bottom)?:\s*[^0\s]/);
        }
    });
});
