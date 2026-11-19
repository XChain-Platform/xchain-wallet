// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared collapse handle (G100): the side menu wears it vertically and
// wide Home's overview divider horizontally. Operator 2026-11-15: the side
// menu's tab is right, and the overview's must be the same tab, the same
// size, turned a quarter. Vitest blanks CSS modules, so the drawing is
// pinned on the sheet; headless Chromium measured both tabs at 10 by 40px
// (side 10x40, overview 40x10) with 24 by 40px hit areas at 1280 and 1920.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CollapseHandle } from '../../../packages/core/src/shared/components/CollapseHandle.jsx';

const css = readFileSync('packages/core/src/shared/components/CollapseHandle.module.css', 'utf8');
const rule = (selector) => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]='()]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
};
const decl = (body, prop) => body.match(new RegExp(`(?:^|\\s)${prop}:\\s*([^;]+);`))?.[1] ?? null;

afterEach(cleanup);

describe('CollapseHandle size and shape', () => {
    const vertical = rule(".handle.handle[data-orientation='vertical']");
    const horizontal = rule(".handle.handle[data-orientation='horizontal']");
    const verticalTab = rule(".handle.handle[data-orientation='vertical']::before");
    const horizontalTab = rule(".handle.handle[data-orientation='horizontal']::before");

    it('keeps the tab 10 by 40px with a 24px hit area', () => {
        const base = rule('.handle.handle');
        expect(decl(base, '--xc-collapse-handle-tab')).toBe('10px');
        expect(decl(base, '--xc-collapse-handle-length')).toBe('40px');
    });

    it('gives the overview handle the side handle\'s size, turned a quarter', () => {
        // Hit area: width and height swap.
        expect(decl(vertical, 'width')).toBe('var(--xc-tap-min)');
        expect(decl(vertical, 'height')).toBe('var(--xc-collapse-handle-length)');
        expect(decl(horizontal, 'width')).toBe(decl(vertical, 'height'));
        expect(decl(horizontal, 'height')).toBe(decl(vertical, 'width'));
        // Drawn tab: the same thickness and inset across the hit area, the
        // full length along it.
        expect(decl(verticalTab, 'width')).toBe('var(--xc-collapse-handle-tab)');
        expect(decl(horizontalTab, 'height')).toBe(decl(verticalTab, 'width'));
        expect(decl(verticalTab, 'inset-block')).toBe('0');
        expect(decl(horizontalTab, 'inset-inline')).toBe('0');
        expect(decl(horizontalTab, 'inset-block-start')).toBe(decl(verticalTab, 'inset-inline-start'));
    });

    it('draws the overview tab as the side tab rotated: open against its line, round far corners', () => {
        // Side: no border on the menu's edge, the two outer corners round.
        expect(decl(verticalTab, 'border-inline-start')).toBe('none');
        expect(decl(verticalTab, 'border-start-end-radius')).toBe('var(--xc-radius-sm)');
        expect(decl(verticalTab, 'border-end-end-radius')).toBe('var(--xc-radius-sm)');
        // Overview: no border on the divider, the two lower corners round,
        // and no all-round radius left from the old tab centred on the line.
        expect(decl(horizontalTab, 'border-block-start')).toBe('none');
        expect(decl(horizontalTab, 'border-end-start-radius')).toBe('var(--xc-radius-sm)');
        expect(decl(horizontalTab, 'border-end-end-radius')).toBe('var(--xc-radius-sm)');
        expect(decl(horizontalTab, 'border-radius')).toBeNull();
        expect(decl(horizontalTab, 'border-start-start-radius')).toBeNull();
        expect(decl(horizontalTab, 'border-start-end-radius')).toBeNull();
    });

    it('points the overview chevron up while open and down while collapsed', () => {
        expect(rule(".handle[data-orientation='horizontal'] .chevron")).toMatch(/transform: rotate\(90deg\);/);
        expect(rule(".handle[data-orientation='horizontal'][data-collapsed='true'] .chevron")).toMatch(/transform: rotate\(-90deg\);/);
        expect(rule(".handle[data-orientation='vertical'][data-collapsed='true'] .chevron")).toMatch(/transform: scaleX\(-1\);/);
    });
});

describe('CollapseHandle control', () => {
    it.each([
        ['horizontal', false, 'Collapse overview', 'true'],
        ['horizontal', true, 'Expand overview', 'false'],
        ['vertical', false, 'Hide side menu', 'true'],
        ['vertical', true, 'Show side menu', 'false'],
    ])('%s, collapsed %s: a named button that says whether its panel is open', (orientation, collapsed, label, expanded) => {
        const onClick = vi.fn();
        render(
            <CollapseHandle
                orientation={orientation}
                collapsed={collapsed}
                aria-label={label}
                aria-controls="panel"
                title={label}
                onClick={onClick}
            />,
        );
        const handle = screen.getByRole('button', { name: label });
        expect(handle.tagName).toBe('BUTTON');
        expect(handle).toHaveAttribute('aria-expanded', expanded);
        expect(handle).toHaveAttribute('aria-controls', 'panel');
        expect(handle).toHaveAttribute('data-orientation', orientation);
        expect(handle).toHaveAttribute('data-collapsed', String(collapsed));
        expect(handle.querySelector('svg')).not.toBeNull();
        // Keyboard focus lands on it and a press reaches the caller.
        handle.focus();
        expect(handle).toHaveFocus();
        expect(handle).not.toHaveAttribute('tabindex', '-1');
        fireEvent.click(handle);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
