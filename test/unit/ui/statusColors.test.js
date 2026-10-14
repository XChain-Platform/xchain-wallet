// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

function declarations(selector, from = 0) {
    const start = css.indexOf(selector, from);
    const open = css.indexOf('{', start);
    let depth = 1;
    let close = open + 1;
    while (depth > 0) {
        if (css[close] === '{') depth += 1;
        if (css[close] === '}') depth -= 1;
        close += 1;
    }
    return Object.fromEntries(
        [...css.slice(open + 1, close - 1).matchAll(/(--xc-[\w-]+):\s*([^;]+);/g)]
            .map((match) => [match[1], match[2].trim()]),
    );
}

function rgb(hex) {
    return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function rgba(value) {
    const parts = value.match(/[\d.]+/g).map(Number);
    return { color: parts.slice(0, 3), alpha: parts[3] };
}

function composite(foreground, background, alpha) {
    return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha));
}

function luminance(color) {
    const channels = color.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a, b) {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

function statusContrast(palette, name, surface) {
    const foreground = rgb(palette[`--xc-${name === 'success' ? name : `${name}-text`}`]);
    const fill = rgba(palette[`--xc-${name}-bg`]);
    const background = composite(fill.color, rgb(palette[surface]), fill.alpha);
    return contrast(foreground, background);
}

describe('semantic status color tokens', () => {
    const light = declarations(':root {');
    const dark = { ...light, ...declarations(':root[data-xc-theme="dark"]') };

    it.each([
        ['light', light, '--xc-bg'],
        ['dark', dark, '--xc-surface'],
    ])('%s theme status text clears WCAG AA on its tinted background', (_theme, palette, surface) => {
        for (const name of ['success', 'warning', 'danger', 'info']) {
            expect(statusContrast(palette, name, surface), name).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each([
        ['light', light],
        ['dark', dark],
    ])('%s theme success fill clears WCAG AA against its label', (_theme, palette) => {
        expect(contrast(rgb(palette['--xc-success-fill']), rgb(palette['--xc-on-success'])))
            .toBeGreaterThanOrEqual(4.5);
    });
});
