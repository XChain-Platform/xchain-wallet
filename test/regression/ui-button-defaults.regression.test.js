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
//        2026-10-13: secondary became the outlined variant so back and
//        cancel actions read as secondary beside a primary fill. It keeps
//        the P1 fix by drawing its label in the accent text colour with a
//        strong border, never the muted body text that looked inert.
//
//   [P1] 2026-04-25: Buttons could wrap to two lines under tight
//        widths (e.g., the popup viewport). Fix: `white-space: nowrap`
//        on the base .btn class.
//
//        Superseded 2026-10-13 by the pseudo-long layout guard: a nowrap
//        label in a long locale was clipped to an ellipsis, hiding what the
//        button does. Labels now wrap inside the button and break long words
//        rather than overflow it, so the pin below is on that contract.

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

function themeTokens(header) {
    const start = tokensCss.indexOf(header);
    expect(start, header).toBeGreaterThanOrEqual(0);
    const body = tokensCss.slice(start, tokensCss.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
        .map(([, name, value]) => [name, value.trim()]));
}

function luminance(hex) {
    return hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i).slice(1)
        .map((channel) => Number.parseInt(channel, 16) / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe('regression/ui-button-defaults', () => {
    it('[REGRESSION P1] every filled variant resolves to #FFFFFF text by default (no dark text bleeding through)', () => {
        for (const variant of ['primary', 'ghost', 'danger']) {
            expect(resolvedColor(variant)).toMatch(/^#FFFFFF$/i);
        }
    });

    it('[REGRESSION P1] the outlined secondary draws an accent label and a strong border, readable in both themes', () => {
        const rule = css.match(/(?:^|\n)\.secondary\s*\{[^}]*\}/)?.[0] ?? '';
        expect(rule).toMatch(/(?:^|[\s;{])color:\s*var\(--xc-accent-text\)/);
        expect(rule).toMatch(/border-color:\s*var\(--xc-border-strong\)/);
        const light = themeTokens(':root {');
        const dark = { ...light, ...themeTokens(':root[data-xc-theme="dark"] {') };
        for (const theme of [light, dark]) {
            for (const surface of ['--xc-bg', '--xc-surface']) {
                expect(contrast(theme['--xc-accent-text'], theme[surface]), surface).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('[REGRESSION P1] base .btn wraps a long label inside the button instead of clipping it', () => {
        const base = css.match(/(?:^|\n)\.btn\s*\{[^}]*\}/);
        expect(base, 'base .btn rule').toBeTruthy();
        expect(base[0]).toMatch(/white-space:\s*normal/);
        // break-word, not anywhere: a squeezed button stops at its longest word.
        expect(base[0]).toMatch(/overflow-wrap:\s*break-word/);
        expect(base[0]).toMatch(/max-width:\s*100%/);
        expect(base[0]).toMatch(/min-width:\s*auto/);
        // A plain-text label is a block, so one overlong word still breaks.
        expect(css).toMatch(/\.textLabel\s*\{[^}]*display:\s*block/);
        expect(base[0]).not.toMatch(/text-overflow:\s*ellipsis/);
    });
});
