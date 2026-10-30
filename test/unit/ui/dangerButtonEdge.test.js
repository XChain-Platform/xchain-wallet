// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A danger button inside the red error notice shares the notice's fill, so
// only its edge sets it apart. The edge uses the label token of the danger
// fill and must clear the 3:1 non-text contrast against the notice.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
const buttonCss = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');
const statusCss = readFileSync('packages/core/src/ui/StatusMessage.module.css', 'utf8');

function block(source, selector) {
    const start = source.indexOf(selector);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', start);
    return source.slice(open + 1, source.indexOf('}', open));
}

function palette(selector) {
    return Object.fromEntries(
        [...block(tokens, selector).matchAll(/(--xc-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
}

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
function luminance(color) {
    const [r, g, b] = color.map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('danger button edge on the error notice', () => {
    it('draws the edge in the danger label token', () => {
        expect(block(buttonCss, '.danger {')).toMatch(/border-color:\s*var\(--xc-on-danger\)/);
        expect(block(statusCss, '.row.error {')).toMatch(/background:\s*var\(--xc-danger\)/);
    });

    it.each([
        ['light', ':root {'],
        ['dark', ':root[data-xc-theme="dark"]'],
    ])('the %s edge clears 3:1 against the notice fill', (_theme, selector) => {
        const light = palette(':root {');
        const theme = { ...light, ...(selector === ':root {' ? {} : palette(selector)) };
        expect(contrast(rgb(theme['--xc-on-danger']), rgb(theme['--xc-danger']))).toBeGreaterThanOrEqual(3);
    });
});
