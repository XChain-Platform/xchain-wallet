// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findChrome102CssIssues } from '../../helpers/chrome102CssAudit.js';

const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');
const audit = (css) => findChrome102CssIssues(postcss.parse(css));

describe('Chrome 102 CSS compatibility audit', () => {
    it('reports every unsupported feature family when it has no fallback or guard', () => {
        const css = `
            .mix { color: color-mix(in srgb, red, blue); }
            .a:has(> img) { color: oklch(50% 0.2 30); width: 2cqw; }
            .b { text-wrap: balance; grid-template-columns: subgrid; height: 2lh; }
            .c { background: light-dark(white, black); container-type: inline-size; }
            .parent { & .child { color: red; } }
            @container (width > 10px) { .d { color: red; } }
            @property --tone { syntax: '<color>'; inherits: true; initial-value: red; }
        `;
        expect(audit(css).map(({ feature }) => feature)).toEqual([
            'color-mix()', 'oklch()/oklab()', 'container unit', 'text-wrap: balance', 'subgrid',
            'lh unit', 'light-dark()', 'container-type', ':has()',
            'native CSS nesting', '@container', '@property',
        ]);
    });

    it('accepts fallback declarations and matching supports guards', () => {
        const css = `
            .a { color: red; color: oklab(50% 0 0); text-wrap: wrap; text-wrap: pretty; }
            @supports selector(:has(*)) { .b:has(> img) { color: red; } }
            @supports (width: 1cqw) { .c { width: 1cqw; } }
            @supports (grid-template-columns: subgrid) { .d { grid-template-columns: subgrid; } }
            @supports (height: 1lh) { .e { height: 1lh; } }
            @supports (color: light-dark(white, black)) { .f { color: light-dark(white, black); } }
            @supports (container-type: inline-size) {
                .g { container-name: card; }
                @container card (width > 10px) { .h { color: red; } }
            }
        `;
        expect(audit(css)).toEqual([]);
    });

    it('keeps every Settings :has() selector behind its feature guard', () => {
        const css = readFileSync(join(
            process.cwd(), 'packages', 'core', 'src', 'shared', 'routes', 'Settings.module.css',
        ), 'utf8');
        expect(audit(css)).toEqual([]);
    });
});
