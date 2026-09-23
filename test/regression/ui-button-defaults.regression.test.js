// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: UI button defaults.
//
//   [P1] 2026-04-25: Secondary buttons rendered with dark text on a
//        light surface, making them look non-functional. Fix: every
//        variant now uses #FFFFFF text on a coloured fill; ghost
//        gained a slate fill so its white text is legible.
//
//   [P1] 2026-04-25: Buttons could wrap to two lines under tight
//        widths (e.g., the popup viewport). Fix: `white-space: nowrap`
//        on the base .btn class.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', '..', 'packages', 'core', 'src', 'ui', 'Button.module.css');
const css = readFileSync(cssPath, 'utf8');
const tokensPath = join(here, '..', '..', 'packages', 'core', 'src', 'ui', 'tokens.css');
const tokensCss = readFileSync(tokensPath, 'utf8');

// `--xc-on-accent` / `--xc-on-danger` default to #FFFFFF in :root, then get
// re-paired to system colours (Canvas/MarkText) under a forced-colors media
// query, so a variant declaring `color: var(--xc-on-accent)` is still white
// text by default - resolve the token rather than requiring a literal.
function resolvedColor(variant) {
    const ruleMatch = css.match(new RegExp(`\\.${variant}\\s*\\{[^}]*\\}`, 'i'));
    if (!ruleMatch) return null;
    const colorMatch = ruleMatch[0].match(/color:\s*([^;]+);/i);
    if (!colorMatch) return null;
    const value = colorMatch[1].trim();
    const varMatch = value.match(/^var\((--[\w-]+)\)$/);
    if (!varMatch) return value;
    const tokenMatch = tokensCss.match(new RegExp(`:root\\s*\\{[^}]*${varMatch[1]}:\\s*([^;]+);`, 'i'));
    return tokenMatch ? tokenMatch[1].trim() : null;
}

describe('regression/ui-button-defaults', () => {
    it('[REGRESSION P1] every variant resolves to #FFFFFF text by default (no dark text bleeding through)', () => {
        for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
            expect(resolvedColor(variant)).toMatch(/^#FFFFFF$/i);
        }
    });

    it('[REGRESSION P1] base .btn declares white-space: nowrap', () => {
        expect(css).toMatch(/\.btn[\s\S]*?white-space:\s*nowrap/);
    });
});
