// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An engine without `color-mix()` drops declarations that use it. These tests
// pin the theme-aware fallback values and both forms of build-time delivery.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    NO_COLOR_MIX, colorMixFallback, fallbackDeclarations, flattenColorMix,
} from '../../../packages/web/cssFallbacks.js';

describe('flattenColorMix', () => {
    it('collapses a mix to the operand with the larger share', () => {
        expect(flattenColorMix('color-mix(in srgb, var(--xc-accent-primary) 80%, #000)'))
            .toBe('var(--xc-accent-primary)');
        expect(flattenColorMix('color-mix(in srgb, var(--xc-accent-primary) 12%, transparent)'))
            .toBe('var(--xc-info-bg)');
        expect(flattenColorMix('color-mix(in srgb, red, blue 70%)')).toBe('blue');
        expect(flattenColorMix('color-mix(in oklab, 30% red, blue)')).toBe('blue');
    });

    it('keeps the first operand on an even or unstated split', () => {
        expect(flattenColorMix('color-mix(in srgb, red, blue)')).toBe('red');
        expect(flattenColorMix('color-mix(in srgb, red 50%, blue 50%)')).toBe('red');
    });

    it('rewrites a mix in place inside a larger value', () => {
        // The hero's own declaration.
        expect(flattenColorMix(
            'linear-gradient(180deg, var(--xc-accent-primary) 0%, color-mix(in srgb, var(--xc-accent-primary) 80%, #000) 100%)',
        )).toBe('linear-gradient(180deg, var(--xc-accent-primary) 0%, var(--xc-accent-primary) 100%)');
        expect(flattenColorMix('1px solid color-mix(in srgb, var(--a) 40%, var(--b))'))
            .toBe('1px solid var(--b)');
    });

    it('handles several mixes and nested mixes', () => {
        expect(flattenColorMix('color-mix(in srgb, red 90%, blue) color-mix(in srgb, red 10%, blue)'))
            .toBe('red blue');
        expect(flattenColorMix('color-mix(in srgb, color-mix(in srgb, red 20%, green) 60%, blue)'))
            .toBe('green');
    });

    it('leaves values without a readable mix untouched', () => {
        expect(flattenColorMix('var(--xc-surface)')).toBe('var(--xc-surface)');
        expect(flattenColorMix('color-mix(in srgb, red)')).toBe('color-mix(in srgb, red)');
    });
});

describe('fallbackDeclarations', () => {
    it('returns a flattened copy of each color-mix declaration and nothing else', () => {
        expect(fallbackDeclarations([
            { prop: 'color', value: '#fff' },
            { prop: 'background', value: 'color-mix(in srgb, var(--a) 80%, #000)' },
            { prop: 'border-color', value: 'color-mix(in srgb, var(--a) 20%, var(--b))', important: true },
        ])).toEqual([
            { prop: 'background', value: 'var(--a)', important: false },
            { prop: 'border-color', value: 'var(--b)', important: true },
        ]);
    });

    it('covers custom properties, which the @supports copy can override', () => {
        expect(fallbackDeclarations([{ prop: '--xc-tint', value: 'color-mix(in srgb, red, blue)' }]))
            .toEqual([{ prop: '--xc-tint', value: 'red', important: false }]);
    });

    it('emits nothing rather than a fallback that still needs color-mix', () => {
        expect(fallbackDeclarations([{ prop: 'background', value: 'color-mix(in srgb, red)' }])).toEqual([]);
    });
});

describe('colorMixFallback plugin', () => {
    // PostCSS is Vite's dependency, not ours; resolve it the way Vite does.
    // The unit config runs from the workspace root.
    const requireFromVite = createRequire(
        createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
    );
    const postcss = requireFromVite('postcss');
    const run = (css) => postcss([colorMixFallback()]).process(css, { from: undefined }).css;
    const squash = (css) => css.replace(/\s+/g, ' ').trim();

    it('is a PostCSS plugin', () => {
        expect(colorMixFallback.postcss).toBe(true);
        expect(colorMixFallback().postcssPlugin).toBe('xchain-color-mix-fallback');
    });

    it('precedes the modern value and appends an old-engine-only copy', () => {
        const out = squash(run('.hero { color: #fff; background: linear-gradient(var(--a) 0%, color-mix(in srgb, var(--a) 80%, #000) 100%); }'));
        expect(out).toBe(
            '.hero { color: #fff; background: linear-gradient(var(--a) 0%, var(--a) 100%); background: linear-gradient(var(--a) 0%, color-mix(in srgb, var(--a) 80%, #000) 100%); } '
            + `@supports ${NO_COLOR_MIX} { .hero { background: linear-gradient(var(--a) 0%, var(--a) 100%); } }`,
        );
    });

    it('uses a precomputed theme token before a translucent semantic mix', () => {
        const out = run('.a { background: color-mix(in srgb, var(--a) 80%, #000); }');
        expect(out.match(/background:/g)).toHaveLength(3);
        expect(out).toMatch(/background:\s*var\(--a\);\s*background:\s*color-mix/);

        const themed = run('.b { background: color-mix(in srgb, var(--xc-danger) 10%, transparent); }');
        expect(themed).toMatch(/background:\s*var\(--xc-danger-bg\);\s*background:\s*color-mix/);
    });

    it('keeps the copy inside the same media query as its rule', () => {
        const out = squash(run('@media (min-width: 600px) { .a { color: color-mix(in srgb, red 10%, blue); } } .b { color: red; }'));
        expect(out).toBe(
            `@media (min-width: 600px) { .a { color: blue; color: color-mix(in srgb, red 10%, blue); } @supports ${NO_COLOR_MIX} { .a { color: blue; } } } .b { color: red; }`,
        );
    });

    it('does not touch rules without color-mix, or keyframes', () => {
        const css = '.a { color: red; } @keyframes pulse { 50% { background: color-mix(in srgb, red, blue); } }';
        expect(run(css)).toBe(css);
    });

    it('is idempotent', () => {
        const once = run('.a { color: color-mix(in srgb, red 10%, blue); }');
        expect(run(once)).toBe(once);
    });
});
