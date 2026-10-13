// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The ticker letter in a balance, activity, DeFi or staking row sits on a
// per-ticker fill set inline. When its colour moved from '#FFFFFF' to an
// inline `var(--xc-on-accent)`, forced-colors mode broke it: that token maps
// to Canvas there (it is paired with accent fills, which become LinkText),
// while the mode repaints this decorative fill to Canvas as well, so the
// letter was painted in its own background colour. The forced-colors e2e
// walk caught it on Home. The colour now lives in the stylesheet, where a
// forced-colors block can re-pair it with CanvasText; an inline colour would
// outrank that block, so none may come back.

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
    'packages/core/src/shared/components/BalanceList.jsx',
    'packages/core/src/shared/components/HomeTabs.jsx',
    'packages/core/src/shared/routes/StakingList.jsx',
];

describe('ticker icon letters stay visible in forced-colors mode', () => {
    it.each(SHEETS)('%s colours .iconLetter in the stylesheet and re-pairs it under forced colors', (file) => {
        const css = stripComments(read(file));
        const base = css.match(/^\.iconLetter\s*\{([^}]*)\}/m);
        expect(base, 'no top-level .iconLetter rule').not.toBeNull();
        expect(base[1]).toMatch(/color:\s*var\(--xc-on-accent\)/);

        const forced = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{\s*\.iconLetter\s*\{([^}]*)\}/);
        expect(forced, 'no forced-colors block for .iconLetter').not.toBeNull();
        expect(forced[1]).toMatch(/color:\s*CanvasText/);
    });

    it.each(RENDERERS)('%s sets only the fill inline, never the letter colour', (file) => {
        const inline = read(file).match(/style=\{\{[^}]*tickerColor\([^}]*\}\}/g) || [];
        expect(inline.length).toBeGreaterThan(0);
        for (const style of inline) expect(style).not.toMatch(/\bcolor:/);
    });
});
