// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Back shows only when the visible navigation cannot already reach the
// screen: no Back on sidebar destinations while the sidebar shows, none on
// bottom-bar tabs while the tab bar shows, Back everywhere else.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import {
    CurrentRouteContext,
    NavSurfaceContext,
} from '../../../packages/core/src/shared/components/navSurface.js';
import {
    NAV_SURFACE_DESTINATIONS,
    ROUTE_REGISTRY,
    SIDEBAR_FOOTER_DESTINATIONS,
    SIDEBAR_PRIMARY_DESTINATIONS,
    SIDEBAR_SECONDARY_DESTINATIONS,
    TAB_BAR_DESTINATIONS,
    isNavSurfaceDestination,
} from '../../../packages/core/src/shared/routeRegistry.js';
import { LeftNav, FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { ShellRouteOutlet } from '../../../packages/core/src/shared/components/ShellRouteOutlet.jsx';

const pageHeaderCss = readFileSync('packages/core/src/ui/PageHeader.module.css', 'utf8');
const pageHeaderSource = readFileSync('packages/core/src/ui/PageHeader.jsx', 'utf8');
const buttonCss = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');
const BACK = { name: 'Back to previous screen' };

function renderAt(surface, routeId, props = {}) {
    return render(
        <NavSurfaceContext.Provider value={surface}>
            <CurrentRouteContext.Provider value={routeId}>
                <PageHeader title="Screen" onBack={() => {}} {...props} />
            </CurrentRouteContext.Provider>
        </NavSurfaceContext.Provider>,
    );
}

afterEach(() => cleanup());

describe('top-level destination map', () => {
    it('lists only real routes, so a renamed route cannot silently keep its slot', () => {
        for (const id of [...NAV_SURFACE_DESTINATIONS.sidebar, ...NAV_SURFACE_DESTINATIONS.tabBar]) {
            expect(ROUTE_REGISTRY[id], id).toBeDefined();
        }
    });

    it('treats drilldowns of a destination section as deeper screens', () => {
        expect(isNavSurfaceDestination('home', 'sidebar')).toBe(true);
        expect(isNavSurfaceDestination('token-detail', 'sidebar')).toBe(false);
        expect(isNavSurfaceDestination('connected-sites', 'sidebar')).toBe(false);
        expect(isNavSurfaceDestination('action-detail', 'tabBar')).toBe(false);
        expect(isNavSurfaceDestination('home', null)).toBe(false);
        expect(isNavSurfaceDestination(null, 'sidebar')).toBe(false);
    });

    it('gives the tab bar its four thumb-row tabs and nothing from More', () => {
        expect([...TAB_BAR_DESTINATIONS]).toEqual(['home', 'history', 'send', 'scan']);
        for (const id of ['receive', 'settings', 'contacts', 'messaging']) {
            expect(isNavSurfaceDestination(id, 'tabBar'), id).toBe(false);
        }
    });
});

describe('PageHeader Back by layout', () => {
    it('keeps Back outside the unlocked layout (no nav surface known)', () => {
        render(<PageHeader title="Create wallet" onBack={() => {}} />);
        expect(screen.getByRole('button', BACK)).toBeInTheDocument();
    });

    it.each(NAV_SURFACE_DESTINATIONS.sidebar)('hides Back on sidebar destination %s', (id) => {
        renderAt('sidebar', id);
        expect(screen.queryByRole('button', BACK)).toBeNull();
    });

    it.each(['token-detail', 'action-detail', 'connected-sites', 'wallet-details', 'menu', 'send-picker'])(
        'shows Back on deeper screen %s with the sidebar',
        (id) => {
            renderAt('sidebar', id);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
        },
    );

    it.each(TAB_BAR_DESTINATIONS)('hides Back on bottom-bar tab %s', (id) => {
        renderAt('tabBar', id);
        expect(screen.queryByRole('button', BACK)).toBeNull();
    });

    it.each(['settings', 'receive', 'contacts', 'messaging', 'markets', 'token-detail'])(
        'shows Back on %s with the tab bar',
        (id) => {
            renderAt('tabBar', id);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
        },
    );

    it('shows Back on a nested sub-screen of a sidebar destination (Settings > Privacy)', () => {
        renderAt('sidebar', 'settings', { nested: true, backLabel: 'Back to settings', title: 'Privacy' });
        expect(screen.getByRole('button', { name: 'Back to settings' })).toBeInTheDocument();
    });

    it('keeps the leading lane and a centred title when Back is hidden', () => {
        const { container } = renderAt('sidebar', 'settings', { title: 'Settings' });
        const header = container.firstElementChild;
        expect(header.children).toHaveLength(3);
        expect(header.children[0].tagName).toBe('SPAN');
        expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Settings');
    });

    // jsdom has no layout, so the equal-height guarantee is pinned as the
    // shared token: the row holds exactly the Back control's height, the
    // small Button size, and no more. Holding the larger side-lane size made
    // a Back-less header 8px taller than one showing Back.
    it('holds the row at the Back control height, so hiding Back keeps the header height', () => {
        expect(pageHeaderCss).toMatch(/\.header\s*\{[^}]*min-height:\s*var\(--xc-control-h-sm\)/);
        expect(pageHeaderCss).not.toMatch(/\.header\s*\{[^}]*min-height:\s*var\(--xc-page-header-side\)/);
        expect(buttonCss).toMatch(/\.sm\s*\{[^}]*min-height:\s*var\(--xc-control-h-sm,\s*28px\)/);
        expect(pageHeaderSource).toMatch(/<Button\s+size="sm"[^>]*icon=\{<BackIcon \/>\}/);
    });

    // A trailing action takes the same small control height, so a screen with
    // one (History refresh, Contacts add) is no taller than one without, and
    // keeps the touch floor through a hit area centred on the box.
    it('sizes trailing actions to the Back control height with a touch-floor hit area', () => {
        const trailing = pageHeaderCss.match(/\n\.trailing button:not\(\[role="menuitem"\]\) \{([^}]*)\}/)?.[1] || '';
        const hit = pageHeaderCss.match(/\n\.trailing button:not\(\[role="menuitem"\]\)::before \{([^}]*)\}/)?.[1] || '';
        for (const prop of ['width', 'height', 'min-width', 'min-height']) {
            expect(trailing).toMatch(new RegExp(`(?:^|\\s)${prop}:\\s*var\\(--xc-control-h-sm\\);`));
        }
        expect(trailing).not.toMatch(/--xc-control-h-md/);
        expect(trailing).toMatch(/position:\s*relative/);
        expect(hit).toMatch(/position:\s*absolute/);
        expect(hit).toMatch(/width:\s*max\(100%,\s*var\(--xc-control-hit-min/);
        expect(hit).toMatch(/height:\s*max\(100%,\s*var\(--xc-control-hit-min/);
    });

    it('still runs onBack from the system Back gesture when the control is hidden', () => {
        const onBack = vi.fn();
        renderAt('sidebar', 'history', { onBack });
        expect(screen.queryByRole('button', BACK)).toBeNull();
        act(() => {
            window.dispatchEvent(new Event('xchain:native-edge-back'));
        });
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('nav surfaces render from the shared map', () => {
    it('LeftNav rows follow the sidebar destination lists', () => {
        render(
            <LeftNav
                currentView="home"
                onSelect={() => {}}
                onOpenSettings={() => {}}
                hasVmAddress
            />,
        );
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        const lists = within(nav).getAllByRole('list');
        expect(within(lists[0]).getAllByRole('button')).toHaveLength(SIDEBAR_PRIMARY_DESTINATIONS.length);
        expect(within(lists[1]).getAllByRole('button')).toHaveLength(SIDEBAR_SECONDARY_DESTINATIONS.length);
        expect(within(nav).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
        expect([...SIDEBAR_FOOTER_DESTINATIONS]).toEqual(['settings']);
    });

    it('LeftNav still drops gated rows', () => {
        render(<LeftNav currentView="home" onSelect={() => {}} isSignerMode hasDexSurface={false} />);
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        for (const label of ['Send', 'Receive', 'DEX', 'Marketplace', 'Contracts']) {
            expect(within(nav).queryByRole('button', { name: label }), label).toBeNull();
        }
        expect(within(nav).getByRole('button', { name: 'Home' })).toBeInTheDocument();
    });

    it('BottomTabBar tabs follow the tab bar destination list', () => {
        const { container } = render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        const ids = [...container.querySelectorAll('[data-bottom-tab]')].map((el) => el.dataset.bottomTab);
        expect(ids).toEqual([...TAB_BAR_DESTINATIONS, 'more']);
    });
});

describe('layout wiring', () => {
    function Shell({ view, nested = false }) {
        return (
            <FullLayoutWithNav
                routeKey={`${view}:0`}
                nav={<nav aria-label="Sidebar stub" />}
                bottomBar={<nav aria-label="Tab bar stub" />}
            >
                <ShellRouteOutlet routeKey={view}>
                    <PageHeader title={view} onBack={() => {}} nested={nested} />
                </ShellRouteOutlet>
            </FullLayoutWithNav>
        );
    }

    function atWidth(width) {
        const original = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        return () => Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
    }

    it('reads the sidebar at a wide width', () => {
        const restore = atWidth(1290);
        try {
            const { rerender } = render(<Shell view="contacts" />);
            expect(screen.getByRole('navigation', { name: 'Sidebar stub' })).toBeInTheDocument();
            expect(screen.queryByRole('button', BACK)).toBeNull();
            rerender(<Shell view="token-detail" />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
            rerender(<Shell view="settings" nested />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('reads the tab bar at a phone width', () => {
        const restore = atWidth(360);
        try {
            const { rerender } = render(<Shell view="send" />);
            expect(screen.getByRole('navigation', { name: 'Tab bar stub' })).toBeInTheDocument();
            expect(screen.queryByRole('button', BACK)).toBeNull();
            rerender(<Shell view="settings" />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
            rerender(<Shell view="contacts" />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
        } finally {
            restore();
        }
    });
});
