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
    'packages/core/src/ui/AssetMark.module.css',
    'packages/core/src/shared/routes/StakingList.module.css',
];

const RENDERERS = [
    'packages/core/src/shared/routes/StakingList.jsx',
];

// Home rows draw their icon through ActivityRow and AssetMark, whose letter
// takes its colours from AssetMark.module.css (audited in SHEETS), so these
// files carry no inline ticker fill or letter colour at all.
const SHEET_ONLY_RENDERERS = [
    'packages/core/src/shared/components/HomeTabs.jsx',
    'packages/core/src/shared/components/ActivityRow.jsx',
    'packages/core/src/ui/AssetMark.jsx',
];
const BALANCE_CSS = read('packages/core/src/shared/components/BalanceList.module.css');

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

    it.each(SHEET_ONLY_RENDERERS)('%s sets no inline ticker fill or letter colour', (file) => {
        const src = read(file);
        expect(src).not.toMatch(/style=\{\{[^}]*tickerColor\(/);
        expect(src).not.toMatch(/style=\{\{[^}]*\bcolor:/);
    });

    it('uses a round neutral balance fallback', () => {
        const balanceIcon = BALANCE_CSS.match(/\.iconLetter\s*\{([^}]*)\}/)?.[1] || '';
        expect(balanceIcon).toMatch(/border-radius:\s*50%/);
        expect(balanceIcon).toMatch(/background:\s*var\(--xc-bg-muted\)/);
        expect(read('packages/core/src/shared/components/BalanceList.jsx'))
            .not.toMatch(/style=\{\{\s*background:\s*tickerColor\(row\.tick\)/);
    });
});
