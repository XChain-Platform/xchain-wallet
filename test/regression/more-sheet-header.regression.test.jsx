// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: More sheet header geometry.
//
//   [P1] 2026-10-13: The More title and close action can collide in narrow
//        phone layouts unless the header reserves a control-sized end column.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomTabBar } from '../../packages/core/src/shared/components/BottomTabBar.jsx';
import buttonStyles from '../../packages/core/src/ui/Button.module.css';
import overlayStyles from '../../packages/core/src/shared/components/OverlaySurface.module.css';

const ROOT = process.cwd();
const overlayCss = readFileSync(join(
    ROOT,
    'packages/core/src/shared/components/OverlaySurface.module.css',
), 'utf8');
const buttonCss = readFileSync(join(ROOT, 'packages/core/src/ui/Button.module.css'), 'utf8');
const tokensCss = readFileSync(join(ROOT, 'packages/core/src/ui/tokens.css'), 'utf8');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

function tokenPx(name) {
    const value = new RegExp(`${name}:\\s*([0-9.]+)px`).exec(tokensCss)?.[1];
    expect(value, `${name} must remain a pixel control token`).toBeTruthy();
    return Number(value);
}

function openMoreSheet() {
    render(
        <BottomTabBar
            currentView="home"
            onSelect={() => {}}
            onLock={() => {}}
            onOpenSettings={() => {}}
            onOpenWalletPicker={() => {}}
        />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const title = screen.getByRole('heading', { name: 'More', level: 2 });
    const close = screen.getByRole('button', { name: 'Close more navigation' });
    return { close, header: title.closest('header'), title };
}

afterEach(() => cleanup());

describe('regression/more-sheet-header', () => {
    it.each([320, 360])(
        '[REGRESSION P1] keeps the More title clear of the close button at %ipx',
        (viewportWidth) => {
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: viewportWidth,
            });
            const { close, header, title } = openMoreSheet();

            expect(header).not.toBeNull();
            expect(title.parentElement).toHaveClass(overlayStyles.title);
            expect(close.parentElement).toHaveClass(overlayStyles.close);

            const headerRule = rule(overlayCss, '.header');
            const surfaceRule = rule(overlayCss, '.surface');
            const sheetRule = rule(overlayCss, '.sheet');
            const titleRule = rule(overlayCss, '.title');
            const closeRule = rule(overlayCss, '.close');
            expect(surfaceRule).toMatch(/box-sizing:\s*border-box/);
            expect(surfaceRule).toMatch(/padding:\s*var\(--xc-space-4\)/);
            expect(surfaceRule).toMatch(/border:\s*1px\s+solid/);
            expect(sheetRule).toMatch(/width:\s*100%/);
            expect(headerRule).toMatch(
                /grid-template-columns:\s*var\(--xc-control-h-md\)\s+minmax\(0,\s*1fr\)\s+var\(--xc-control-h-md\)/,
            );
            expect(headerRule).toMatch(/gap:\s*var\(--xc-space-2\)/);
            expect(titleRule).toMatch(/grid-column:\s*2/);
            expect(titleRule).toMatch(/min-width:\s*0/);
            expect(closeRule).toMatch(/grid-column:\s*3/);

            const control = tokenPx('--xc-control-h-md');
            const gap = tokenPx('--xc-space-2');
            const padding = tokenPx('--xc-space-4');
            const border = 1;
            const headerWidth = viewportWidth - (2 * (padding + border));
            const titleTrackWidth = headerWidth - (2 * control) - (2 * gap);
            const titleTrackEnd = control + gap + titleTrackWidth;
            const closeTrackStart = headerWidth - control;

            expect(titleTrackWidth).toBeGreaterThan(0);
            expect(closeTrackStart - titleTrackEnd).toBe(gap);
        },
    );

    it('[REGRESSION P1] sizes the More close action from the medium control token', () => {
        const { close } = openMoreSheet();
        const mediumRule = rule(buttonCss, '.md');
        const iconOnlyRule = rule(buttonCss, '.iconOnly');
        const closeRule = rule(overlayCss, '.close');

        expect(close).toHaveClass(buttonStyles.md, buttonStyles.iconOnly);
        expect(mediumRule).toMatch(/--xc-button-height:\s*var\(--xc-control-h-md\)/);
        expect(iconOnlyRule).toMatch(/width:\s*var\(--xc-button-height\)/);
        expect(iconOnlyRule).toMatch(/min-width:\s*var\(--xc-button-height\)/);
        expect(closeRule).toMatch(/width:\s*var\(--xc-control-h-md\)/);
        expect(closeRule).toMatch(/height:\s*var\(--xc-control-h-md\)/);
        expect(tokenPx('--xc-control-h-md')).toBeGreaterThanOrEqual(tokenPx('--xc-tap-min'));
    });
});
