// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G100 accessibility contract of the side menu: the resize edge is a
// focusable vertical separator with its value range, the Icons rail keeps
// every row's name, and the collapsed line leaves only the handle to reach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

vi.mock('../../../packages/core/src/shared/styles/useLayoutTier.js', () => ({
    useLayoutTier: () => [{ current: null }, 'full'],
}));

const { FullLayoutWithNav, LeftNav } = await import('../../../packages/core/src/shared/components/LeftNav.jsx');
const { SIDE_MENU_STORAGE_KEY } = await import('../../../packages/core/src/shared/hooks/useSideMenu.js');

function renderShell(state) {
    if (state) localStorage.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify({ state, extra: 0, lastOpen: 'full' }));
    return render(
        <FullLayoutWithNav
            nav={(
                <LeftNav
                    currentView="history"
                    onSelect={() => {}}
                    onOpenSettings={() => {}}
                    onLock={() => {}}
                    onCommandPalette={() => {}}
                />
            )}
        >
            <main id="xc-main" tabIndex={-1}><h1>History</h1></main>
        </FullLayoutWithNav>,
    );
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('side menu accessibility', () => {
    it('exposes the resize edge as a focusable vertical separator with its range', async () => {
        const { container } = renderShell('full');
        const edge = screen.getByRole('separator', { name: 'Resize side menu' });
        expect(edge).toHaveAttribute('aria-orientation', 'vertical');
        expect(edge).toHaveAttribute('aria-controls', 'xc-side-menu');
        const now = Number(edge.getAttribute('aria-valuenow'));
        const min = Number(edge.getAttribute('aria-valuemin'));
        const max = Number(edge.getAttribute('aria-valuemax'));
        // From the icon rail up to Full's widest (operator 2026-11-13).
        expect(min).toBe(64);
        expect(max).toBeGreaterThan(min);
        expect(now).toBeGreaterThanOrEqual(min);
        expect(now).toBeLessThanOrEqual(max);
        edge.focus();
        expect(edge).toHaveFocus();
        await expectNoSeriousAxeViolations(container);
    });

    it('keeps a name and tooltip on every Icons rail control', async () => {
        const { container } = renderShell('icons');
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        const controls = [...nav.querySelectorAll('button')];
        expect(controls.length).toBeGreaterThan(4);
        for (const control of controls) {
            expect(control.textContent.trim() || control.getAttribute('aria-label')).toBeTruthy();
            expect(control).toHaveAttribute('title');
        }
        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('title', 'Home');
        // Icons keeps the resize edge; there is no Show Names row (operator 2026-11-13).
        expect(screen.getByRole('separator', { name: 'Resize side menu' })).toBeInTheDocument();
        await expectNoSeriousAxeViolations(container);
    });

    it('leaves the collapsed menu one reachable, named, expandable handle', async () => {
        const { container } = renderShell('collapsed');
        expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull();
        const toggle = screen.getByRole('button', { name: 'Show Side Menu' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        toggle.focus();
        expect(toggle).toHaveFocus();
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(toggle);
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hide Side Menu' })).toHaveAttribute('aria-expanded', 'true');
    });
});
