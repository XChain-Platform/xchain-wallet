// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tokenIn } from '../../../packages/web/src/style-guide/tokenValues.js';

const COMPONENTS = [
    'packages/core/src/shared/components/HomeTabs.module.css',
    'packages/core/src/shared/components/PortfolioChart.jsx',
    'packages/core/src/shared/components/PortfolioChart.module.css',
    'packages/core/src/shared/components/Sparkline.jsx',
    'packages/core/src/shared/components/Sparkline.module.css',
    'packages/core/src/shared/components/TotalBalanceHero.module.css',
    'packages/core/src/shared/components/LeftNav.module.css',
    'packages/core/src/ui/ListRow.module.css',
    'packages/core/src/ui/SegmentedControl.module.css',
];

const SHARED_INTERACTION_VALUES = {
    '--xc-toggle-selected-bg': '#1A7BAC',
    '--xc-toggle-selected-text': '#FFFFFF',
    '--xc-row-active-bg': 'rgba(26, 123, 172, 0.20)',
};

const HERO_VALUES = {
    light: {
        '--xc-hero-bg': '#EEF6FC',
        '--xc-hero-text': '#0F172A',
        '--xc-hero-border': '#9DB8D3',
        '--xc-hero-chart-up': '#15803D',
        '--xc-hero-chart-down': '#C81E1E',
        '--xc-hero-chart-fill-opacity': '0.22',
        '--xc-hero-guide': '#7FA6C8',
        '--xc-hero-guide-opacity': '0.55',
        '--xc-hero-chip-selected-bg': '#1A7BAC',
        '--xc-hero-chip-selected-text': '#FFFFFF',
        '--xc-hero-pill-up-bg': '#DCFCE7',
        '--xc-hero-pill-up-text': '#14532D',
        '--xc-hero-pill-down-bg': '#FEE2E2',
        '--xc-hero-pill-down-text': '#991B1B',
        '--xc-hero-scale-text': '#2C5070',
    },
    dark: {
        '--xc-hero-bg': '#10213A',
        '--xc-hero-text': '#E5EAF2',
        '--xc-hero-border': '#2B4566',
        '--xc-hero-chart-up': '#4ADE80',
        '--xc-hero-chart-down': '#F87171',
        '--xc-hero-chart-fill-opacity': '0.22',
        '--xc-hero-guide': '#7FA6C8',
        '--xc-hero-guide-opacity': '0.55',
        '--xc-hero-chip-selected-bg': '#1A7BAC',
        '--xc-hero-chip-selected-text': '#FFFFFF',
        '--xc-hero-pill-up-bg': 'rgba(74, 222, 128, 0.16)',
        '--xc-hero-pill-up-text': '#4ADE80',
        '--xc-hero-pill-down-bg': 'rgba(248, 113, 113, 0.16)',
        '--xc-hero-pill-down-text': '#FCA5A5',
        '--xc-hero-scale-text': '#9DB8D9',
    },
};

describe('scheme semantic color tokens', () => {
    it.each(['light', 'dark'])('%s keeps Hero 2 and the current interaction colors', (theme) => {
        for (const [token, value] of Object.entries({ ...SHARED_INTERACTION_VALUES, ...HERO_VALUES[theme] })) {
            expect(tokenIn(theme, token), token).toBe(value);
        }
    });

    it('keeps the current per-theme row hover and link colors', () => {
        expect(tokenIn('light', '--xc-row-hover-bg')).toBe('rgba(15, 23, 42, 0.10)');
        expect(tokenIn('dark', '--xc-row-hover-bg')).toBe('rgba(229, 234, 242, 0.10)');
        expect(tokenIn('light', '--xc-link')).toBe('#156690');
        expect(tokenIn('dark', '--xc-link')).toBe('#4AA8D8');
    });

    it.each(COMPONENTS)('%s contains no literal CSS color', (file) => {
        const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(source, file).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    });

    it('routes hero, toggle, row and link roles through their semantic tokens', () => {
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        const portfolio = readFileSync('packages/core/src/shared/components/PortfolioChart.jsx', 'utf8');
        const toggle = readFileSync('packages/core/src/ui/SegmentedControl.module.css', 'utf8');
        const nav = readFileSync('packages/core/src/shared/components/LeftNav.module.css', 'utf8');
        const rows = readFileSync('packages/core/src/ui/ListRow.module.css', 'utf8');

        expect(portfolio).toContain("'var(--xc-hero-chart-line)'");
        expect(portfolio).toContain("'var(--xc-hero-chart-fill)'");
        expect(toggle).toContain('background: var(--xc-toggle-selected-bg)');
        expect(toggle).toContain('color: var(--xc-toggle-selected-text)');
        expect(nav).toContain('background: var(--xc-row-active-bg)');
        expect(nav).toContain('background: var(--xc-row-hover-bg)');
        expect(rows).toContain('background: var(--xc-row-active-bg)');
        expect(rows).toContain('background: var(--xc-row-hover-bg)');
        expect(tokens).toMatch(/:where\(a\[href\]\)\s*\{[^}]*color:\s*var\(--xc-link\)/s);
    });
});
