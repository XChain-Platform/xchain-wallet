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
            .b { text-wrap: balance; grid-template-columns: subgrid; height: 2lh; min-height: 2rlh; }
            .c { background: light-dark(white, black); container-type: inline-size; min-height: 100dvh; }
            .future:popover-open { field-sizing: content; transition-timing-function: linear(0, 1); }
            .math { width: round(up, 2.3px, 1px); view-transition-name: card; }
            .parent { & .child { color: red; } }
            @container (width > 10px) { .d { color: red; } }
            @scope (.card) { .e { color: red; } }
            @starting-style { .f { opacity: 0; } }
        `;
        expect(audit(css).map(({ feature }) => feature)).toEqual([
            'color-mix()', 'modern color function', 'container unit', 'text-wrap: balance', 'subgrid',
            'lh/rlh unit', 'lh/rlh unit', 'modern color function', 'container-type', 'modern viewport unit',
            'field-sizing', 'linear() easing', 'modern math function', 'view-transition-name', ':has()',
            'modern pseudo-selector', 'native CSS nesting', '@container', '@scope', '@starting-style',
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
            @supports (height: 100dvh) { .viewport { height: 100dvh; } }
            @supports selector(:popover-open) { .popover:popover-open { color: red; } }
            @supports (container-type: inline-size) {
                .g { container-name: card; }
                @container card (width > 10px) { .h { color: red; } }
            }
            @layer reset { .i { color: red; } }
            @property --tone { syntax: '<color>'; inherits: true; initial-value: red; }
        `;
        expect(audit(css)).toEqual([]);
    });

    it('keeps Header settings backgrounds free of color-mix without build transforms', () => {
        const header = readFileSync(join(
            process.cwd(), 'packages', 'core', 'src', 'shared', 'components',
            'HeaderSettingsButton.module.css',
        ), 'utf8');
        expect(header).not.toContain('color-mix(');
        expect(header).toMatch(/--header-accent-bg-subtle:\s*rgba\(26, 123, 172, 0\.10\)/);
        expect(header.match(/var\(--header-accent-bg-subtle\)/g)).toHaveLength(2);
        expect(audit(header)).toEqual([]);
    });

    it('keeps the Settings narrow fallback independent of :has()', () => {
        const settingsCss = readFileSync(join(
            process.cwd(), 'packages', 'core', 'src', 'shared', 'routes', 'Settings.module.css',
        ), 'utf8');
        expect(settingsCss).not.toContain(':has(');
        expect(settingsCss).toMatch(/@media \(max-width: 480px\)[\s\S]*\.page div\s*\{[\s\S]*flex-wrap:\s*wrap !important;/);
        expect(audit(settingsCss)).toEqual([]);
    });

    it.each([
        'ConfirmActionModal.module.css',
        'ActionIntentSummary.module.css',
    ])('uses viewport reflow without container queries in %s', (file) => {
        const css = readFileSync(join(
            process.cwd(), 'packages', 'core', 'src', 'shared', 'components', file,
        ), 'utf8');
        expect(css).toContain('@media (max-width: 480px)');
        expect(css).not.toMatch(/@container|container-type/);
        expect(audit(css)).toEqual([]);
    });
});
