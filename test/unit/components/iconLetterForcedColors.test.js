// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Icon monograms keep their foreground in stylesheets so forced-colors mode
// can pair them with the platform canvas.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const SHEETS = [
    'packages/core/src/shared/components/BalanceList.module.css',
    'packages/core/src/shared/routes/StakingList.module.css',
];

const RENDERERS = [
    'packages/core/src/shared/components/HomeTabs.jsx',
    'packages/core/src/shared/routes/StakingList.jsx',
];
const BALANCE_CSS = read('packages/core/src/shared/components/BalanceList.module.css');
const TOKEN_DETAIL_CSS = read('packages/core/src/shared/routes/TokenDetail.module.css');

describe('ticker icon letters stay visible in forced-colors mode', () => {
    it.each(SHEETS)('%s colours .iconLetter in the stylesheet and re-pairs it under forced colors', (file) => {
        const css = stripComments(read(file));
        const base = css.match(/^\.iconLetter\s*\{([^}]*)\}/m);
        expect(base, 'no top-level .iconLetter rule').not.toBeNull();
        expect(base[1]).toMatch(/color:\s*var\(--xc-(?:on-accent|text)\)/);

        const forced = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{\s*\.iconLetter\s*\{([^}]*)\}/);
        expect(forced, 'no forced-colors block for .iconLetter').not.toBeNull();
        expect(forced[1]).toMatch(/color:\s*CanvasText/);
    });

    it.each(RENDERERS)('%s sets only the fill inline, never the letter colour', (file) => {
        const inline = read(file).match(/style=\{\{[^}]*tickerColor\([^}]*\}\}/g) || [];
        expect(inline.length).toBeGreaterThan(0);
        for (const style of inline) expect(style).not.toMatch(/\bcolor:/);
    });

    it('uses a round neutral balance fallback and token-sized detail title artwork', () => {
        const balanceIcon = BALANCE_CSS.match(/\.iconLetter\s*\{([^}]*)\}/)?.[1] || '';
        expect(balanceIcon).toMatch(/border-radius:\s*50%/);
        expect(balanceIcon).toMatch(/background:\s*var\(--xc-bg-muted\)/);
        expect(read('packages/core/src/shared/components/BalanceList.jsx'))
            .not.toMatch(/style=\{\{\s*background:\s*tickerColor\(row\.tick\)/);

        for (const selector of ['headerIcon', 'headerIconFallback']) {
            const rule = TOKEN_DETAIL_CSS.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] || '';
            expect(rule).toMatch(/width:\s*var\(--xc-icon-lg\)/);
            expect(rule).toMatch(/height:\s*var\(--xc-icon-lg\)/);
        }
    });
});
