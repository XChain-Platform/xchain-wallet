// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A secondary Button reads its label from --xc-accent-text. On every notice
// variant that label clears 4.5:1 against the notice fill, in both themes.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const ui = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'core', 'src', 'ui');
const tokensRoot = postcss.parse(readFileSync(join(ui, 'tokens.css'), 'utf8'));
const noticeRoot = postcss.parse(readFileSync(join(ui, 'StatusMessage.module.css'), 'utf8'));

function decls(root, match) {
    const out = {};
    root.walkRules((rule) => {
        if (!match(rule)) return;
        rule.each((n) => { if (n.type === 'decl' && n.prop.startsWith('--')) out[n.prop] = n.value; });
    });
    return out;
}

const light = decls(tokensRoot, (r) => r.selector === ':root' && r.parent.type === 'root');
const dark = { ...light, ...decls(tokensRoot, (r) => r.selector === ':root[data-xc-theme="dark"]' && r.parent.type === 'root') };

function parse(value, theme) {
    const v = value.trim();
    const ref = v.match(/^var\((--[\w-]+)\)$/);
    if (ref) return parse(theme[ref[1]], theme);
    const hex = v.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const rgba = v.match(/^rgba?\(([^)]+)\)$/);
    if (rgba) {
        const p = rgba[1].split(',').map(Number);
        return [p[0], p[1], p[2], p[3] ?? 1];
    }
    throw new Error(`unparsed colour ${value}`);
}

function over(fg, bg) {
    return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
}

function lum(c) {
    const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const fills = { status: '--xc-info-bg', info: '--xc-info-bg', warning: '--xc-warning-bg', success: '--xc-success-bg', error: '--xc-danger' };

describe('StatusMessage secondary Button contrast', () => {
    for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
        for (const [variant, fillToken] of Object.entries(fills)) {
            it(`${variant} notice, ${themeName} theme: label is at least 4.5:1`, () => {
                const own = decls(noticeRoot, (r) => r.selector === `.row.${variant}`);
                const scoped = { ...theme, ...own };
                const fill = over(parse(`var(${fillToken})`, scoped), parse('var(--xc-bg)', scoped));
                const label = over(parse('var(--xc-accent-text)', scoped), fill);
                expect(ratio(label, fill)).toBeGreaterThanOrEqual(4.5);
            });
        }
    }
});
