// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G100: the side menu's three states (collapsed, icons, full), the handle
// that collapses and restores it, the Icons Only / Show Names row, the
// resize edge (a separator: drag, keys, double-click reset) and the per-device
// persistence that survives a reload.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/styles/useLayoutTier.js', () => ({
    useLayoutTier: () => [{ current: null }, globalThis.__tier ?? 'full'],
}));

const {
    FullLayoutWithNav,
    LeftNav,
} = await import('../../../packages/core/src/shared/components/LeftNav.jsx');
const {
    SIDE_MENU_FALLBACK_WIDTH_PX,
    SIDE_MENU_KEY_STEP_PX,
    SIDE_MENU_MAX_EXTRA_PX,
    SIDE_MENU_MIN_CONTENT_PX,
    SIDE_MENU_STORAGE_KEY,
    clampSideMenuExtra,
    readSideMenuPrefs,
    sideMenuExtraCeiling,
    stepSideMenuState,
} = await import('../../../packages/core/src/shared/hooks/useSideMenu.js');

function Shell() {
    return (
        <FullLayoutWithNav
            nav={<LeftNav currentView="home" onSelect={() => {}} onOpenSettings={() => {}} onLock={() => {}} />}
        >
            <main id="xc-main" tabIndex={-1}>Route</main>
        </FullLayoutWithNav>
    );
}

const shell = () => document.querySelector('[data-xc-tier]');
const handle = () => screen.getByRole('button', { name: /Side Menu$/ });
const separator = () => screen.getByRole('separator', { name: 'Resize side menu' });
// The nav's <hr> divider is a separator too, so absence checks go by name.
const noResizer = () => screen.queryByRole('separator', { name: 'Resize side menu' });
// jsdom has no PointerEvent, and fireEvent's stand-in drops clientX, so
// pointer events go out as MouseEvents carrying the pointer type name.
const pointer = (target, type, clientX) => act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }));
});
const saved = () => JSON.parse(localStorage.getItem(SIDE_MENU_STORAGE_KEY));
const leftNavCss = readFileSync('packages/core/src/shared/components/LeftNav.module.css', 'utf8');
// Writes broadcast on a microtask; let them land before the next assertion.
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); delete globalThis.__tier; });

describe('side menu state helpers', () => {
    it('clamps the dragged extra to 0..300 whole pixels', () => {
        expect(clampSideMenuExtra(-40)).toBe(0);
        expect(clampSideMenuExtra(120.6)).toBe(121);
        expect(clampSideMenuExtra(999)).toBe(SIDE_MENU_MAX_EXTRA_PX);
        expect(clampSideMenuExtra(Number.NaN)).toBe(0);
        expect(clampSideMenuExtra(250, 100)).toBe(100);
        expect(clampSideMenuExtra(900, 900)).toBe(SIDE_MENU_MAX_EXTRA_PX);
    });

    it('never lets a wide menu push the content under the rail-tier floor', () => {
        expect(sideMenuExtraCeiling(0, 180)).toBe(SIDE_MENU_MAX_EXTRA_PX);
        expect(sideMenuExtraCeiling(1440, 180)).toBe(SIDE_MENU_MAX_EXTRA_PX);
        expect(sideMenuExtraCeiling(900, 180)).toBe(900 - SIDE_MENU_MIN_CONTENT_PX - 180);
        expect(sideMenuExtraCeiling(700, 180)).toBe(0);
    });

    it('steps collapsed, icons, full and stops at the widest the tier allows', () => {
        expect(stepSideMenuState('full', -1)).toBe('icons');
        expect(stepSideMenuState('icons', -1)).toBe('collapsed');
        expect(stepSideMenuState('collapsed', -1)).toBe('collapsed');
        expect(stepSideMenuState('collapsed', 1)).toBe('icons');
        expect(stepSideMenuState('icons', 1)).toBe('full');
        expect(stepSideMenuState('full', 1)).toBe('full');
        expect(stepSideMenuState('icons', 1, 'icons')).toBe('icons');
        expect(stepSideMenuState('full', 0, 'icons')).toBe('icons');
    });

    it('reads damaged or missing storage as the full default', () => {
        expect(readSideMenuPrefs()).toEqual({ state: 'full', extra: 0, lastOpen: 'full', railOpen: 'icons' });
        localStorage.setItem(SIDE_MENU_STORAGE_KEY, '{not json');
        expect(readSideMenuPrefs().state).toBe('full');
        localStorage.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify({ state: 'wide', extra: 5000 }));
        expect(readSideMenuPrefs()).toEqual({ state: 'full', extra: SIDE_MENU_MAX_EXTRA_PX, lastOpen: 'full', railOpen: 'icons' });
    });
});

describe('FullLayoutWithNav side menu', () => {
    it('gives the collapsed sidebar zero width and no border', () => {
        const match = leftNavCss.match(/\.layout\[data-xc-rail='shown'\]\[data-xc-side-menu='collapsed'\]\s*>\s*\.sidebar\s*\{([^}]*)\}/);
        expect(match?.[1]).toMatch(/width:\s*0;/);
        expect(match?.[1]).toMatch(/border:\s*0;/);
        expect(match?.[1]).toMatch(/background:\s*transparent;/);
    });

    it('opens Full by default with names, the resize edge and the collapse handle', () => {
        render(<Shell />);
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
        expect(handle()).toHaveAccessibleName('Hide Side Menu');
        expect(handle()).toHaveAttribute('aria-expanded', 'true');
        expect(handle()).toHaveAttribute('aria-controls', 'xc-side-menu');
        expect(separator()).toHaveAttribute('aria-valuenow', String(SIDE_MENU_FALLBACK_WIDTH_PX));
        // The edge does the work (operator 2026-11-13): no menu-size rows.
        expect(screen.queryByRole('button', { name: /Icons Only|Show Names|Hide Menu/ })).toBeNull();
    });

    it('collapses fully with only the handle reachable, then restores', async () => {
        render(<Shell />);
        fireEvent.click(handle());
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'collapsed');
        expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
        expect(noResizer()).toBeNull();
        expect(handle()).toHaveAccessibleName('Show Side Menu');
        expect(handle()).toHaveAttribute('aria-expanded', 'false');
        // The shared collapse handle (wide Home's overview divider wears the
        // same one), standing on the edge and flipping its chevron.
        expect(handle()).toHaveAttribute('data-orientation', 'vertical');
        expect(handle()).toHaveAttribute('data-collapsed', 'true');
        const focusable = [...shell().querySelectorAll('button, [tabindex="0"], a[href]')];
        expect(focusable).toContain(handle());
        expect(focusable.filter((el) => el.closest('#xc-side-menu'))).toEqual([]);
        expect(saved()).toMatchObject({ state: 'collapsed', lastOpen: 'full', railOpen: 'icons' });

        fireEvent.click(handle());
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    });

    it('switches to Icons, where every row keeps its name as tooltip and accessible name', async () => {
        render(<Shell />);
        // Narrower than Full's minimum on the edge snaps to Icons.
        fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        // Icons keeps the edge, so it can be pulled back wider.
        expect(separator()).toHaveAttribute('aria-valuenow', '64');
        for (const name of ['Home', 'History', 'Settings']) {
            const row = screen.getByRole('button', { name });
            expect(row).toHaveAttribute('title', name);
        }
        // Collapsing from Icons restores Icons, not Full.
        fireEvent.click(handle());
        await flush();
        fireEvent.click(handle());
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
    });

    it('steps through the three states with the arrow keys on the handle', async () => {
        render(<Shell />);
        fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'collapsed');
        fireEvent.keyDown(handle(), { key: 'ArrowRight' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        fireEvent.keyDown(handle(), { key: 'ArrowRight' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
    });

    it('resizes from the keyboard within the min and max, and Home or Enter resets', async () => {
        render(<Shell />);
        const min = SIDE_MENU_FALLBACK_WIDTH_PX;
        expect(separator()).toHaveAttribute('aria-orientation', 'vertical');
        // The edge runs from the icon rail (64px) to Full's widest.
        expect(separator()).toHaveAttribute('aria-valuemin', '64');
        expect(separator()).toHaveAttribute('aria-valuemax', String(min + SIDE_MENU_MAX_EXTRA_PX));
        expect(separator()).toHaveAttribute('tabindex', '0');

        // At Full's narrowest, narrower snaps to Icons and wider snaps back.
        fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        expect(separator()).toHaveAttribute('aria-valuenow', String(min));

        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        await flush();
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + SIDE_MENU_KEY_STEP_PX));
        fireEvent.keyDown(separator(), { key: 'ArrowRight', shiftKey: true });
        await flush();
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + SIDE_MENU_KEY_STEP_PX * 5));
        expect(shell().style.getPropertyValue('--xc-side-menu-extra')).toBe(`${SIDE_MENU_KEY_STEP_PX * 5}px`);

        fireEvent.keyDown(separator(), { key: 'End' });
        await flush();
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + SIDE_MENU_MAX_EXTRA_PX));
        for (let i = 0; i < 3; i += 1) fireEvent.keyDown(separator(), { key: 'ArrowRight', shiftKey: true });
        await flush();
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + SIDE_MENU_MAX_EXTRA_PX));
        expect(saved().extra).toBe(SIDE_MENU_MAX_EXTRA_PX);

        fireEvent.keyDown(separator(), { key: 'Home' });
        await flush();
        expect(separator()).toHaveAttribute('aria-valuenow', String(min));
        fireEvent.keyDown(separator(), { key: 'End' });
        fireEvent.keyDown(separator(), { key: 'Enter' });
        await flush();
        expect(saved().extra).toBe(0);
    });

    it('drags the edge with clamping, and a double-click resets to the default width', async () => {
        render(<Shell />);
        const min = SIDE_MENU_FALLBACK_WIDTH_PX;
        pointer(separator(), 'pointerdown', 200);
        pointer(window, 'pointermove', 290);
        expect(shell()).toHaveAttribute('data-xc-side-menu-drag', 'on');
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + 90));
        pointer(window, 'pointermove', 2000);
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + SIDE_MENU_MAX_EXTRA_PX));
        pointer(window, 'pointerup', 2000);
        await flush();
        expect(shell()).not.toHaveAttribute('data-xc-side-menu-drag');
        expect(saved().extra).toBe(SIDE_MENU_MAX_EXTRA_PX);

        fireEvent.doubleClick(separator());
        await flush();
        expect(separator()).toHaveAttribute('aria-valuenow', String(min));
        expect(saved().extra).toBe(0);
    });

    it('drops to Icons while dragging, before release, once pushed well inside the minimum', async () => {
        render(<Shell />);
        pointer(separator(), 'pointerdown', 300);
        pointer(window, 'pointermove', 200);
        await flush();
        // Snapped live (operator 2026-11-13), not only on release.
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        pointer(window, 'pointerup', 200);
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
    });

    it('snaps back and forth between Full and Icons within one drag', async () => {
        render(<Shell />);
        const min = SIDE_MENU_FALLBACK_WIDTH_PX;
        pointer(separator(), 'pointerdown', min);
        pointer(window, 'pointermove', min - 30);
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        pointer(window, 'pointermove', min - 60);
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        pointer(window, 'pointermove', min + 40);
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        expect(separator()).toHaveAttribute('aria-valuenow', String(min + 40));
        pointer(window, 'pointerup', min + 40);
        await flush();
        expect(saved().extra).toBe(40);
    });

    it('restores the saved state and width on the first render after a reload', () => {
        localStorage.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify({ state: 'full', extra: 120, lastOpen: 'full' }));
        render(<Shell />);
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        expect(shell().style.getPropertyValue('--xc-side-menu-extra')).toBe('120px');
        cleanup();

        localStorage.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify({ state: 'collapsed', extra: 120, lastOpen: 'icons' }));
        render(<Shell />);
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'collapsed');
        fireEvent.click(handle());
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
    });

    it('keeps its own choice on the rail tier: Icons by default, Full when pulled wider there', async () => {
        globalThis.__tier = 'rail';
        localStorage.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify({ state: 'full', extra: 40, lastOpen: 'full' }));
        render(<Shell />);
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        expect(saved().state).toBe('full');
        // Names can show at any width with a side menu (operator 2026-11-13).
        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        expect(shell()).toHaveAttribute('data-xc-tier', 'full');
        expect(saved()).toMatchObject({ state: 'full', railOpen: 'full' });
    });

    it('snaps Icons to Full when the edge is dragged past the snap distance', async () => {
        render(<Shell />);
        fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        pointer(separator(), 'pointerdown', 64);
        pointer(window, 'pointermove', 90);
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        pointer(window, 'pointermove', 140);
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'full');
        pointer(window, 'pointerup', 140);
    });

    it('restores a saved Full from the keyboard on the rail tier without losing it', async () => {
        globalThis.__tier = 'rail';
        localStorage.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify({ state: 'full', extra: 0, lastOpen: 'full' }));
        render(<Shell />);
        fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'collapsed');
        fireEvent.keyDown(handle(), { key: 'ArrowRight' });
        await flush();
        expect(shell()).toHaveAttribute('data-xc-side-menu', 'icons');
        expect(saved().state).toBe('full');
    });

    it('renders no side menu controls on the compact tier', () => {
        globalThis.__tier = 'compact';
        render(<Shell />);
        expect(shell()).not.toHaveAttribute('data-xc-side-menu');
        expect(screen.queryByRole('button', { name: /Side Menu$/ })).toBeNull();
        expect(noResizer()).toBeNull();
    });
});
