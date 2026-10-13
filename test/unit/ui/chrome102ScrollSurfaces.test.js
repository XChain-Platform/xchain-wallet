// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath) {
    return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

const surfaces = [
    ['command palette', 'packages/core/src/shared/commandPalette/CommandPalette.module.css', '.list'],
    ['alerts drawer', 'packages/core/src/shared/components/AlertsOverlay.module.css', '.body'],
    ['bottom sheet', 'packages/core/src/shared/components/BottomTabBar.module.css', '.sheetBody'],
    ['file viewer', 'packages/core/src/shared/components/GatedFileViewer.module.css', '.body'],
    ['network picker', 'packages/core/src/shared/components/NetworkFilter.module.css', '.list'],
    ['shortcut help', 'packages/core/src/shared/keyboard/ShortcutHelp.module.css', '.body'],
];

describe('Chrome 102 scroll surfaces', () => {
    it.each(surfaces)('%s keeps touch scrolling inside its bounded region', (_name, path, selector) => {
        const declaration = rule(read(path), selector);

        expect(declaration).toMatch(/overflow(?:-y)?:\s*auto/);
        expect(declaration).toMatch(/min-height:\s*0/);
        expect(declaration).toMatch(/overscroll-behavior:\s*contain/);
    });

    it.each([
        [
            'bottom sheet',
            'packages/core/src/shared/components/BottomTabBar.module.css',
            '.sheet',
            /min\(70vh,\s*var\(--xc-viewport-h,\s*100vh\)\)/,
            true,
        ],
        [
            'file viewer',
            'packages/core/src/shared/components/GatedFileViewer.module.css',
            '.panel',
            /min\([\s\S]*85vh,[\s\S]*var\(--xc-viewport-h,\s*100vh\)/,
            true,
        ],
        [
            'command palette',
            'packages/core/src/shared/commandPalette/CommandPalette.module.css',
            '.overlay',
            /max-height:\s*var\(--xc-viewport-h,\s*100vh\)/,
            false,
        ],
        [
            'shortcut help',
            'packages/core/src/shared/keyboard/ShortcutHelp.module.css',
            '.overlay',
            /max-height:\s*var\(--xc-viewport-h,\s*100vh\)/,
            false,
        ],
    ])('%s caps itself to the fitted WebView height', (_name, path, selector, expected, shrinkable) => {
        const declaration = rule(read(path), selector);

        expect(declaration).toMatch(expected);
        if (shrinkable) expect(declaration).toMatch(/min-height:\s*0/);
    });

    it.each([
        ['command palette', 'packages/core/src/shared/commandPalette/CommandPalette.module.css', '.panel'],
        ['alerts drawer', 'packages/core/src/shared/components/AlertsOverlay.module.css', '.panel'],
        ['bottom sheet', 'packages/core/src/shared/components/BottomTabBar.module.css', '.sheet'],
        ['file viewer', 'packages/core/src/shared/components/GatedFileViewer.module.css', '.panel'],
        ['shortcut help', 'packages/core/src/shared/keyboard/ShortcutHelp.module.css', '.panel'],
    ])('%s lets its internal scroller shrink below min-content height', (_name, path, selector) => {
        expect(rule(read(path), selector)).toMatch(/min-height:\s*0/);
    });

    it('keeps the narrow market toggle sticky in the route overflow container', () => {
        const css = read('packages/core/src/shared/components/MarketTrading.module.css');

        expect(css).toMatch(
            /@media \(max-width: 420px\)[\s\S]*\.sideToggle\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/,
        );
    });

    it('does not depend on unsupported momentum or dynamic viewport declarations', () => {
        for (const [, path] of surfaces) {
            const css = read(path);
            expect(css).not.toContain('-webkit-overflow-scrolling');
            expect(css).not.toMatch(/\b(?:dvh|svh|lvh)\b/);
        }
    });
});
