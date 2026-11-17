// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Back follows the shell's one navigation history (G06): it shows on a page
// opened from another page, and is left out on a root page, one opened from
// the sidebar, the bottom bar, the menu or the palette. The nav surface on
// screen no longer decides it: Send opened from Token detail shows Back with
// the sidebar and with the tab bar alike.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { InPageScreen, NavHistoryContext } from '../../../packages/core/src/ui/navHistory.js';
import {
    CurrentRouteContext,
    NavSurfaceContext,
} from '../../../packages/core/src/shared/components/navSurface.js';
import {
    NAV_SURFACE_DESTINATIONS,
    ROUTE_REGISTRY,
    SIDEBAR_FOOTER_DESTINATIONS,
    SIDEBAR_NAV_GROUPS,
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

/** A header inside a shell whose history is (canGoBack) or is not on a root page. */
function renderAt(surface, routeId, canGoBack, props = {}) {
    return render(
        <NavSurfaceContext.Provider value={surface}>
            <CurrentRouteContext.Provider value={routeId}>
                <NavHistoryContext.Provider value={{ canGoBack }}>
                    <PageHeader title="Screen" onBack={() => {}} {...props} />
                </NavHistoryContext.Provider>
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

    it('gives the tab bar its five catalogue destinations', () => {
        expect([...TAB_BAR_DESTINATIONS]).toEqual(['home', 'send', 'receive', 'history', 'settings']);
        for (const id of ['scan', 'contacts', 'messaging']) {
            expect(isNavSurfaceDestination(id, 'tabBar'), id).toBe(false);
        }
    });
});

describe('PageHeader Back by history', () => {
    it('keeps Back outside a shell (no history known)', () => {
        render(<PageHeader title="Create wallet" onBack={() => {}} />);
        expect(screen.getByRole('button', BACK)).toBeInTheDocument();
    });

    it.each(NAV_SURFACE_DESTINATIONS.sidebar)('shows Back on sidebar destination %s opened from another page', (id) => {
        renderAt('sidebar', id, true);
        expect(screen.getByRole('button', BACK)).toBeInTheDocument();
    });

    it.each(NAV_SURFACE_DESTINATIONS.sidebar)('hides Back on sidebar destination %s opened as a root', (id) => {
        renderAt('sidebar', id, false);
        expect(screen.queryByRole('button', BACK)).toBeNull();
    });

    it.each(TAB_BAR_DESTINATIONS)('shows Back on bottom-bar tab %s opened from another page', (id) => {
        renderAt('tabBar', id, true);
        expect(screen.getByRole('button', BACK)).toBeInTheDocument();
    });

    it.each(TAB_BAR_DESTINATIONS)('hides Back on bottom-bar tab %s opened as a root', (id) => {
        renderAt('tabBar', id, false);
        expect(screen.queryByRole('button', BACK)).toBeNull();
    });

    it.each(['token-detail', 'action-detail', 'connected-sites', 'market'])(
        'hides Back on %s opened from the palette as a root',
        (id) => {
            renderAt('sidebar', id, false);
            expect(screen.queryByRole('button', BACK)).toBeNull();
        },
    );

    it('shows Back on a nested sub-screen of a root page (Settings > Privacy)', () => {
        renderAt('sidebar', 'settings', false, { nested: true, backLabel: 'Back to settings', title: 'Privacy' });
        expect(screen.getByRole('button', { name: 'Back to settings' })).toBeInTheDocument();
    });

    it('shows no Back without a handler, even when the history has a previous page', () => {
        renderAt('sidebar', 'token-detail', true, { onBack: undefined });
        expect(screen.queryByRole('button', BACK)).toBeNull();
    });

    it('keeps the leading lane and a centred title when Back is hidden', () => {
        const { container } = renderAt('sidebar', 'settings', false, { title: 'Settings' });
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
        expect(buttonCss).toMatch(/\.sm\s*\{[^}]*min-height:\s*calc\(var\(--xc-space-6\) \+ var\(--xc-space-1\)\)/);
        const back = pageHeaderSource.slice(pageHeaderSource.indexOf('{showBack ? ('), pageHeaderSource.indexOf(') : ('));
        expect(back).toMatch(/className=\{styles\.back\}/);
        expect(back).toMatch(/icon=\{<BackIcon \/>\}/);
        expect(back).toMatch(/aria-label=\{accessibleBackLabel\}/);
        expect(back).toMatch(/onClick=\{onBack\}/);
        expect(back).not.toMatch(/variant="secondary"/);
        const backRule = pageHeaderCss.match(/\n\.header \.back \{([^}]*)\}/)?.[1] || '';
        expect(backRule).toMatch(/min-height:\s*var\(--xc-control-h-sm\);/);
    });

    // U38: Back is the header's bare chevron. It paints no border, outline,
    // shadow or fill, keeps the touch-floor hit area of the other header
    // controls and shows a focus ring only for keyboard focus.
    it('draws Back as a bare chevron with no border, outline or fill', () => {
        const back = pageHeaderCss.match(/\n\.header \.back \{([^}]*)\}/)?.[1] || '';
        const hit = pageHeaderCss.match(/\n\.header \.back::before(?:,\n[^{]*)? \{([^}]*)\}/)?.[1] || '';
        const focus = pageHeaderCss.match(/\n\.header \.back:focus-visible \{([^}]*)\}/)?.[1] || '';
        expect(back).toMatch(/background:\s*transparent;/);
        expect(back).toMatch(/(?:^|\s)border:\s*0;/);
        expect(back).toMatch(/(?:^|\s)outline:\s*none;/);
        expect(back).toMatch(/box-shadow:\s*none;/);
        expect(hit).toMatch(/width:\s*max\(100%,\s*var\(--xc-control-hit-min/);
        expect(hit).toMatch(/height:\s*max\(100%,\s*var\(--xc-control-hit-min/);
        expect(focus).toMatch(/outline:\s*2px solid var\(--xc-focus-ring\)/);

        renderAt('sidebar', 'token-detail', true);
        const button = screen.getByRole('button', BACK);
        expect(button.className).toContain('back');
        expect(button.className).not.toMatch(/secondary/);
    });

    // A trailing action takes the same small control height, so a screen with
    // one (History refresh, Contacts add) is no taller than one without, and
    // keeps the touch floor through a hit area centred on the box.
    it('sizes trailing actions to the app bar button height with a touch-floor hit area', () => {
        const trailing = pageHeaderCss.match(/\n\.trailing button:not\(\[role="menuitem"\], \[role="dialog"\] \*\) \{([^}]*)\}/)?.[1] || '';
        const hit = pageHeaderCss.match(/\n\.trailing button:not\(\[role="menuitem"\], \[role="dialog"\] \*\)::before \{([^}]*)\}/)?.[1] || '';
        // The approved redesign sizes trailing icon buttons to the app bar's 44px buttons (G82).
        for (const prop of ['width', 'height', 'min-width', 'min-height']) {
            expect(trailing).toMatch(new RegExp(`(?:^|\\s)${prop}:\\s*var\\(--xc-control-h-md\\);`));
        }
        expect(trailing).not.toMatch(/--xc-control-h-sm/);
        expect(trailing).toMatch(/position:\s*relative/);
        expect(hit).toMatch(/position:\s*absolute/);
        expect(hit).toMatch(/width:\s*max\(100%,\s*var\(--xc-control-hit-min/);
        expect(hit).toMatch(/height:\s*max\(100%,\s*var\(--xc-control-hit-min/);
    });

    // The system Back gesture and Android Back follow the same history: on a
    // root page the chevron is hidden, yet the gesture still runs onBack.
    it('still runs onBack from the system Back gesture when the control is hidden', () => {
        const onBack = vi.fn();
        renderAt('sidebar', 'history', false, { onBack });
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
                hasBtcAddress
                hasGovernanceAddress
            />,
        );
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        for (const group of SIDEBAR_NAV_GROUPS) {
            const list = within(nav).getByRole('list', {
                name: group.id.charAt(0).toUpperCase() + group.id.slice(1),
            });
            expect(within(list).getAllByRole('button')).toHaveLength(group.destinations.length);
        }
        expect(within(nav).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
        expect([...SIDEBAR_FOOTER_DESTINATIONS]).toEqual(['settings']);
    });

    it('LeftNav still drops gated rows', () => {
        render(<LeftNav currentView="home" onSelect={() => {}} isSignerMode hasDexSurface={false} />);
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        for (const label of [
            'Send', 'Receive', 'Exchange (DEX)', 'Marketplace', 'Governance', 'Staking', 'Contracts',
        ]) {
            expect(within(nav).queryByRole('button', { name: label }), label).toBeNull();
        }
        expect(within(nav).getByRole('button', { name: 'Home' })).toBeInTheDocument();
    });

    it('BottomTabBar tabs follow the tab bar destination list', () => {
        const { container } = render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        const ids = [...container.querySelectorAll('[data-bottom-tab]')].map((el) => el.dataset.bottomTab);
        expect(ids).toEqual([...TAB_BAR_DESTINATIONS]);
    });
});

describe('layout wiring', () => {
    function Shell({ view, canGoBack, nested = false }) {
        return (
            <FullLayoutWithNav
                routeKey={`${view}:0`}
                nav={<nav aria-label="Sidebar stub" />}
                bottomBar={<nav aria-label="Tab bar stub" />}
            >
                <ShellRouteOutlet routeKey={view} canGoBack={canGoBack}>
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

    it('takes Back from the shell history with the sidebar on screen', () => {
        const restore = atWidth(1290);
        try {
            const { rerender } = render(<Shell view="send" canGoBack={false} />);
            expect(screen.getByRole('navigation', { name: 'Sidebar stub' })).toBeInTheDocument();
            expect(screen.queryByRole('button', BACK)).toBeNull();
            rerender(<Shell view="send" canGoBack />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
            rerender(<Shell view="settings" canGoBack={false} nested />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('takes Back from the shell history with the tab bar on screen', () => {
        const restore = atWidth(360);
        try {
            const { rerender } = render(<Shell view="receive" canGoBack={false} />);
            expect(screen.getByRole('navigation', { name: 'Tab bar stub' })).toBeInTheDocument();
            expect(screen.queryByRole('button', BACK)).toBeNull();
            rerender(<Shell view="receive" canGoBack />);
            expect(screen.getByRole('button', BACK)).toBeInTheDocument();
            rerender(<Shell view="contacts" canGoBack={false} />);
            expect(screen.queryByRole('button', BACK)).toBeNull();
        } finally {
            restore();
        }
    });

    it('shows Back on a screen a root page opens in its own place', () => {
        render(
            <ShellRouteOutlet routeKey="market" canGoBack={false}>
                <InPageScreen>
                    <PageHeader title="Trade" onBack={() => {}} />
                </InPageScreen>
            </ShellRouteOutlet>,
        );
        expect(screen.getByRole('button', BACK)).toBeInTheDocument();
    });

    it('keeps Back on every screen when the outlet is given no history', () => {
        render(
            <ShellRouteOutlet routeKey="send">
                <PageHeader title="send" onBack={() => {}} />
            </ShellRouteOutlet>,
        );
        expect(screen.getByRole('button', BACK)).toBeInTheDocument();
    });
});
