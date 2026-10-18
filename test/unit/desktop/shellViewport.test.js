// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop window is a fixed-height shell: the header and sidebar stay
// pinned and only the route's content pane scrolls. A shell that grows past
// the window (or a page shown below 100 percent scale) makes the whole
// document scroll and leaves the sidebar ending partway down the window.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();
const read = (...parts) => readFileSync(join(repo, ...parts), 'utf8');
const postcss = createRequire(
    createRequire(join(repo, 'packages', 'web', 'package.json')).resolve('vite'),
)('postcss');

function declarations(css, selector) {
    const rule = postcss.parse(css).nodes.find((node) => node.type === 'rule' && node.selector === selector);
    expect(rule, `${selector} rule`).toBeTruthy();
    return Object.fromEntries(rule.nodes
        .filter((node) => node.type === 'decl')
        .map((node) => [node.prop, node.value]));
}

describe('desktop shell viewport', () => {
    it('never lets pinch zoom shrink the page below its natural scale', () => {
        const main = read('packages', 'desktop', 'main', 'index.js');
        const floor = Number(main.match(/const MIN_VISUAL_ZOOM_LEVEL = ([\d.]+);/)?.[1]);

        expect(floor).toBeGreaterThanOrEqual(1);
        expect(main).toMatch(/setVisualZoomLevelLimits\(\s*MIN_VISUAL_ZOOM_LEVEL,/);
    });

    it('sizes the renderer root to the viewport and hands that height to the shell', () => {
        const renderer = read('packages', 'desktop', 'renderer', 'main.jsx');

        expect(renderer).toMatch(/flexDirection: 'column', height: 'var\(--xc-viewport-h, 100vh\)'/);
        expect(renderer).toMatch(/flex: '1 1 auto', minHeight: 0, '--xc-screen-h': '100%'/);
    });

    it('keeps the shell at viewport height with both columns clipped', () => {
        const shell = read('packages', 'core', 'src', 'shared', 'components', 'LeftNav.module.css');

        expect(declarations(shell, '.layout').height)
            .toBe('var(--xc-screen-h, var(--xc-viewport-h, 100vh))');
        for (const column of ['.sidebar', '.main']) {
            expect(declarations(shell, column), column).toMatchObject({ height: '100%', overflow: 'hidden' });
        }
        expect(declarations(shell, '.main')['--xc-screen-h']).toBe('100%');
    });

    it('makes the Screen body the only scroll container', () => {
        const screen = read('packages', 'core', 'src', 'ui', 'Screen.module.css');

        expect(declarations(screen, '.screen')).toMatchObject({
            height: 'var(--xc-screen-h, var(--xc-viewport-h, 100vh))',
            overflow: 'hidden',
        });
        expect(declarations(screen, '.body')).toMatchObject({
            'min-height': '0',
            'overflow-y': 'auto',
        });
    });
});
