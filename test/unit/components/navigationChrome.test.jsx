// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent as keyboardUser } from '../../helpers/userEvent.js';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import {
    isNavItemActive,
    LeftNav,
    LEFT_NAV_VIEW_GROUPS,
} from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { Screen, ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';

afterEach(() => cleanup());

const TABBABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

// The workspace does not install @testing-library/user-event, so this local
// driver supplies its Tab behavior without adding a package for one test.
const userEvent = {
    tab({ shift = false } = {}) {
        const active = document.activeElement || document.body;
        const movesNatively = fireEvent.keyDown(active, {
            key: 'Tab',
            code: 'Tab',
            shiftKey: shift,
        });
        if (movesNatively) {
            const tabbable = [...document.querySelectorAll(TABBABLE)]
                .filter((element) => !element.closest('[inert]') && element.tabIndex >= 0);
            const current = tabbable.indexOf(active);
            const next = shift
                ? (current <= 0 ? tabbable.length - 1 : current - 1)
                : (current + 1) % tabbable.length;
            tabbable[next]?.focus();
        }
        fireEvent.keyUp(document.activeElement || active, {
            key: 'Tab',
            code: 'Tab',
            shiftKey: shift,
        });
    },
};

const settleFocus = () => act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 25); });
});

const NAV_ITEMS = [
    'home',
    'history',
    'send',
    'receive',
    'scan',
    'markets',
    'dispensers-list',
    'contracts-list',
    'messaging',
    'contacts',
    'lists',
    'obligations',
    'settings',
];

describe('navigation route highlighting', () => {
    it('marks exactly one owning bottom tab for every grouped route', () => {
        const tabByGroup = {
            home: 'Home',
            history: 'History',
            send: 'Send',
            scan: 'Scan',
            settings: 'More',
        };
        const { rerender } = render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        const bottomNavigation = within(screen.getByRole('navigation', { name: 'Bottom navigation' }));

        for (const [group, routes] of Object.entries(LEFT_NAV_VIEW_GROUPS)) {
            for (const route of routes) {
                rerender(<BottomTabBar currentView={route} onSelect={() => {}} />);
                const activeTabs = bottomNavigation.getAllByRole('button')
                    .filter((tab) => tab.getAttribute('aria-current') === 'page');

                expect(activeTabs, route).toHaveLength(1);
                expect(activeTabs[0], route).toHaveAccessibleName(tabByGroup[group] || 'Home');
            }
        }
    });

    it.each([
        ['send-picker', 'send'],
        ['receive-picker', 'receive'],
        ['action-detail', 'history'],
        ['cross-chain-order', 'markets'],
        ['contract-stake', 'contracts-list'],
        ['list-transfer', 'lists'],
        ['coinpay', 'obligations'],
        ['connected-sites', 'settings'],
        ['wizard', 'home'],
    ])('maps %s to one active parent, %s', (view, expected) => {
        const active = NAV_ITEMS.filter((item) => isNavItemActive(item, view));
        expect(active).toEqual([expected]);
    });

    it('marks the matching LeftNav row on drilldown routes', () => {
        render(<LeftNav currentView="action-detail" onSelect={() => {}} />);
        expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('marks Home and the matching row for sheet-only destinations', () => {
        render(
            <BottomTabBar
                currentView="contract-stake"
                onSelect={() => {}}
                hasVmAddress
            />,
        );
        const more = screen.getByRole('button', { name: 'More' });
        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
        expect(more).not.toHaveAttribute('aria-current');
        fireEvent.click(more);
        expect(screen.getByRole('button', { name: 'Contracts' })).toHaveAttribute('aria-current', 'page');
    });

    it('marks Home for the compact menu route in the shared Home group', () => {
        render(<BottomTabBar currentView="menu" onSelect={() => {}} />);
        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current');
    });
});

describe('More sheet dismissal', () => {
    it('roves one bottom-bar tab stop and supports jump keys', async () => {
        const user = keyboardUser.setup();
        const onSelect = vi.fn();
        render(<BottomTabBar currentView="home" onSelect={onSelect} />);
        const tabs = ['Home', 'History', 'Send', 'Scan', 'More'].map((name) => (
            screen.getByRole('button', { name })
        ));

        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
        await user.tab();
        expect(tabs[0]).toHaveFocus();
        fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
        expect(tabs[1]).toHaveFocus();
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
        expect(onSelect).toHaveBeenLastCalledWith('history');
        fireEvent.keyDown(tabs[1], { key: 'End' });
        expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(tabs[4]).toHaveFocus();
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
        fireEvent.keyDown(tabs[4], { key: 'Home' });
        expect(tabs[0]).toHaveFocus();
    });

    it('closes immediately when a destination or footer action is selected', () => {
        const onSelect = vi.fn();
        const onOpenSettings = vi.fn();
        render(
            <BottomTabBar
                currentView="home"
                onSelect={onSelect}
                onOpenSettings={onOpenSettings}
            />,
        );
        const more = screen.getByRole('button', { name: 'More' });

        fireEvent.click(more);
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        expect(onSelect).toHaveBeenCalledWith('receive');
        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
        expect(more).toHaveFocus();

        fireEvent.click(more);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(onOpenSettings).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
        expect(more).toHaveFocus();
    });

    it('returns focus to More after Escape closes the sheet', () => {
        render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        const more = screen.getByRole('button', { name: 'More' });
        fireEvent.click(more);
        screen.getByRole('button', { name: 'Receive' }).focus();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
        expect(more).toHaveFocus();
    });

    it('traps user-event Tab in the sheet and restores More on close', async () => {
        render(
            <>
                <button type="button">Before navigation</button>
                <BottomTabBar
                    currentView="home"
                    onSelect={() => {}}
                    onLock={() => {}}
                    onOpenSettings={() => {}}
                />
                <button type="button">After navigation</button>
            </>,
        );
        const more = screen.getByRole('button', { name: 'More' });
        more.focus();
        fireEvent.click(more);
        await settleFocus();

        const receive = screen.getByRole('button', { name: 'Receive' });
        const lock = screen.getByRole('button', { name: 'Lock wallet' });
        expect(receive).toHaveFocus();

        lock.focus();
        userEvent.tab();
        expect(receive).toHaveFocus();
        userEvent.tab({ shift: true });
        expect(lock).toHaveFocus();
        expect(screen.getByRole('button', { name: 'After navigation' })).not.toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(more).toHaveFocus();
    });
});

describe('navigation Tab order', () => {
    it('enters the bottom bar at its one roving tab stop and leaves on the next Tab', () => {
        render(
            <>
                <button type="button">Before navigation</button>
                <BottomTabBar currentView="home" onSelect={() => {}} />
                <button type="button">After navigation</button>
            </>,
        );
        screen.getByRole('button', { name: 'Before navigation' }).focus();

        // Arrow keys move between the tabs; Tab passes over the rest of the bar.
        for (const label of ['Home', 'After navigation']) {
            userEvent.tab();
            expect(screen.getByRole('button', { name: label })).toHaveFocus();
        }
    });

    it('reaches every side navigation action in DOM order', () => {
        render(
            <>
                <button type="button">Before navigation</button>
                <LeftNav
                    currentView="home"
                    onSelect={() => {}}
                    onCommandPalette={() => {}}
                    onOpenWalletPicker={() => {}}
                    onOpenSettings={() => {}}
                    onLock={() => {}}
                    walletName="Main wallet"
                    hasVmAddress
                />
                <button type="button">After navigation</button>
            </>,
        );
        screen.getByRole('button', { name: 'Before navigation' }).focus();

        const order = [
            'Open command palette', 'Home', 'History', 'Send', 'Receive',
            'Scan', 'DEX', 'Dispensers', 'Contracts', 'Messaging', 'Contacts',
            'Lists', 'Payments due', 'Main wallet', 'Settings', 'Lock',
            'After navigation',
        ];
        for (const label of order) {
            userEvent.tab();
            expect(screen.getByRole('button', { name: label })).toHaveFocus();
        }
    });
});

describe('route scroll position', () => {
    function Route({ routeKey }) {
        return (
            <ScrollRestoration routeKey={routeKey}>
                <Screen><div>{routeKey}</div></Screen>
            </ScrollRestoration>
        );
    }

    it('restores a list after a detail route and starts unseen routes at the top', () => {
        const view = render(<Route routeKey="history" />);
        const main = document.getElementById('xc-main');
        main.scrollTop = 418;

        view.rerender(<Route routeKey="action-detail" />);
        expect(document.getElementById('xc-main').scrollTop).toBe(0);
        document.getElementById('xc-main').scrollTop = 73;

        view.rerender(<Route routeKey="history" />);
        expect(document.getElementById('xc-main').scrollTop).toBe(418);
    });

    it('scrolls the active bottom tab to the top', () => {
        const onSelect = vi.fn();
        render(
            <>
                <main id="xc-main" />
                <BottomTabBar currentView="history" onSelect={onSelect} />
            </>,
        );
        const main = document.getElementById('xc-main');
        main.scrollTop = 255;

        fireEvent.click(screen.getByRole('button', { name: 'History' }));

        expect(main.scrollTop).toBe(0);
        expect(onSelect).toHaveBeenCalledWith('history');
    });
});

describe('AppHeader button labels and tooltips', () => {
    it('gives each header action an accessible label and tooltip', () => {
        render(
            <AppHeader
                onMenuOpen={() => {}}
                onScan={() => {}}
                onCommandPalette={() => {}}
                onLock={() => {}}
                onOpenWalletPicker={() => {}}
                platformCurrent="wallet"
            />,
        );

        const expected = [
            ['Settings', 'Settings'],
            ['Open command palette', 'Search (Cmd/Ctrl+K)'],
            ['Scan and addresses', 'Scan and addresses'],
            ['Lock wallet', 'Lock wallet'],
            ['XChain platform sites', 'XChain platform sites'],
            ['Open menu', 'Open menu'],
        ];
        for (const [label, title] of expected) {
            expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', title);
        }
    });
});
