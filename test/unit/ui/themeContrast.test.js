// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const css = readFileSync(resolve(root, 'packages/core/src/ui/tokens.css'), 'utf8');
const buttonCss = readFileSync(resolve(root, 'packages/core/src/ui/Button.module.css'), 'utf8');
const addressComboboxCss = readFileSync(resolve(root, 'packages/core/src/ui/AddressCombobox.module.css'), 'utf8');

function declarationsFor(pattern) {
    const body = pattern.exec(css)?.[1];
    expect(body, pattern.source).toBeTruthy();
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
        .map(([, name, value]) => [name, value.trim()]));
}

const light = declarationsFor(/^:root\s*\{([\s\S]*?)^\}/m);
const dark = {
    ...light,
    ...declarationsFor(/^:root\[data-xc-theme="dark"\]\s*\{([\s\S]*?)^\}/m),
};

function resolveToken(tokens, name, seen = new Set()) {
    expect(seen.has(name), `circular token ${name}`).toBe(false);
    const value = tokens[name];
    expect(value, name).toBeTruthy();
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    return reference ? resolveToken(tokens, reference[1], new Set([...seen, name])) : value;
}

function color(value) {
    const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
    if (hex) return [...hex.slice(1).map((part) => Number.parseInt(part, 16)), 1];
    const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
    expect(rgba, `CSS color ${value}`).toBeTruthy();
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
}

function composite(foreground, background) {
    const fg = typeof foreground === 'string' ? color(foreground) : foreground;
    const bg = typeof background === 'string' ? color(background) : background;
    return fg.slice(0, 3).map((channel, index) => channel * fg[3] + bg[index] * (1 - fg[3]));
}

function saturate(value, amount) {
    const [red, green, blue] = typeof value === 'string' ? color(value) : value;
    return [
        (0.213 + 0.787 * amount) * red + (0.715 - 0.715 * amount) * green + (0.072 - 0.072 * amount) * blue,
        (0.213 - 0.213 * amount) * red + (0.715 + 0.285 * amount) * green + (0.072 - 0.072 * amount) * blue,
        (0.213 - 0.213 * amount) * red + (0.715 - 0.715 * amount) * green + (0.072 + 0.928 * amount) * blue,
    ];
}

function luminance(value) {
    const channels = typeof value === 'string' ? color(value).slice(0, 3) : value.slice(0, 3);
    return channels
        .map((channel) => channel / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const themes = { light, dark };
const backgrounds = ['--xc-bg', '--xc-bg-muted', '--xc-surface', '--xc-surface-raised'];

function expectPair(tokens, foreground, background, minimum) {
    const ratio = contrast(resolveToken(tokens, foreground), resolveToken(tokens, background));
    expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
}

describe('theme token contrast', () => {
    it.each(Object.entries(themes))('%s theme keeps primary and muted text at 4.5:1 on every surface', (_, tokens) => {
        for (const foreground of ['--xc-text', '--xc-text-muted']) {
            for (const background of backgrounds) expectPair(tokens, foreground, background, 4.5);
        }
    });

    it.each(Object.entries(themes))('%s theme keeps borders and composited focus rings at 3:1', (_, tokens) => {
        for (const backgroundName of backgrounds) {
            for (const border of ['--xc-border', '--xc-border-strong']) {
                expectPair(tokens, border, backgroundName, 3);
            }
            const background = resolveToken(tokens, backgroundName);
            const ring = composite(resolveToken(tokens, '--xc-focus-ring'), background);
            expect(contrast(ring, background), `focus ring on ${backgroundName}`).toBeGreaterThanOrEqual(3);
        }
    });

    it.each(Object.entries(themes))('%s theme keeps semantic text and filled-control labels at 4.5:1', (_, tokens) => {
        for (const foreground of ['--xc-accent-text', '--xc-danger-fg', '--xc-warning', '--xc-success']) {
            for (const background of ['--xc-bg', '--xc-surface', '--xc-surface-raised']) {
                expectPair(tokens, foreground, background, 4.5);
            }
        }
        for (const [foreground, background] of [
            ['--xc-on-accent', '--xc-accent-primary'],
            ['--xc-on-danger', '--xc-danger'],
            ['--xc-on-success', '--xc-success'],
        ]) {
            expectPair(tokens, foreground, background, 4.5);
        }
    });

    it.each(Object.entries(themes))('%s theme preserves those ratios for disabled controls', (_, tokens) => {
        expect(Number(resolveToken(tokens, '--xc-disabled-opacity'))).toBe(1);
        const saturation = Number(resolveToken(tokens, '--xc-disabled-saturation'));
        expect(saturation).toBeGreaterThanOrEqual(0);
        expect(saturation).toBeLessThan(1);
        for (const [foreground, background] of [
            ['--xc-on-accent', '--xc-accent-primary'],
            ['--xc-on-danger', '--xc-danger'],
            ['--xc-on-success', '--xc-success'],
            ['--xc-text', '--xc-surface'],
        ]) {
            const disabledForeground = saturate(resolveToken(tokens, foreground), saturation);
            const disabledBackground = saturate(resolveToken(tokens, background), saturation);
            expect(contrast(disabledForeground, disabledBackground), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }

        const disabledBorder = saturate(resolveToken(tokens, '--xc-border-strong'), saturation);
        const disabledSurface = saturate(resolveToken(tokens, '--xc-surface'), saturation);
        expect(contrast(disabledBorder, disabledSurface), '--xc-border-strong on --xc-surface').toBeGreaterThanOrEqual(3);
    });

    it('uses the disabled-state tokens instead of component opacity', () => {
        expect(css).toMatch(/:where\(input, select, textarea, button\):disabled\s*\{[^}]*opacity:\s*var\(--xc-disabled-opacity\)\s*!important/s);
        expect(css).toMatch(/filter:\s*saturate\(var\(--xc-disabled-saturation\)\)/);
        expect(buttonCss).toMatch(/\.success\s*\{[^}]*color:\s*var\(--xc-on-success\)/s);
    });

    it('keeps the address dropdown on contrast-tested theme tokens', () => {
        expect(addressComboboxCss).not.toMatch(/var\(--(?:surface|surface-hover|border|text|text-muted|badge-bg|badge-fg)\b/);
        expect(addressComboboxCss).toContain('background: var(--xc-surface)');
        expect(addressComboboxCss).toContain('color: var(--xc-text-muted)');
    });
});
