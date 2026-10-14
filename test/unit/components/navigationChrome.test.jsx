// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent as keyboardUser } from '../../helpers/userEvent.js';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    activeLeftNavItem,
    isNavItemActive,
    LeftNav,
} from '../../../packages/core/src/shared/components/LeftNav.jsx';
import {
    ROUTE_NAV_SECTIONS,
    ROUTE_REGISTRY,
} from '../../../packages/core/src/shared/routeRegistry.js';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
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
    'market-activity',
    'dispensers-list',
    'contracts-list',
    'messaging',
    'contacts',
    'lists',
    'obligations',
    'settings',
];

describe('navigation route highlighting', () => {
    it('uses the shared section assignment for every registered route', () => {
        const bottomTabBySection = {
            home: 'Home',
            history: 'History',
            send: 'Send',
            scan: 'Scan',
        };
        const sidebarLabelBySection = {
            home: 'Home',
            history: 'History',
            send: 'Send',
            receive: 'Receive',
            scan: 'Scan',
            markets: 'DEX',
            'market-activity': 'Marketplace',
            'dispensers-list': 'Dispensers',
            'contracts-list': 'Contracts',
            messaging: 'Messaging',
            contacts: 'Contacts',
            lists: 'Lists',
            obligations: 'Payments due',
            settings: 'Settings',
        };
        const { rerender } = render(
            <>
                <BottomTabBar currentView="home" onSelect={() => {}} />
                <LeftNav
                    currentView="home"
                    onSelect={() => {}}
                    onOpenSettings={() => {}}
                    hasVmAddress
                />
            </>,
        );

        for (const route of Object.keys(ROUTE_REGISTRY)) {
            const section = ROUTE_NAV_SECTIONS[route];
            expect(section, route).toBeTypeOf('string');
            rerender(
                <>
                    <BottomTabBar currentView={route} onSelect={() => {}} />
                    <LeftNav
                        currentView={route}
                        onSelect={() => {}}
                        onOpenSettings={() => {}}
                        hasVmAddress
                    />
                </>,
            );

            const bottomNavigation = within(screen.getByRole('navigation', { name: 'Bottom navigation' }));
            const activeTabs = bottomNavigation.getAllByRole('button')
                .filter((tab) => tab.getAttribute('aria-current') === 'page');
            const expectedBottomTab = bottomTabBySection[section];
            expect(activeTabs, route).toHaveLength(expectedBottomTab ? 1 : 0);
            if (expectedBottomTab) expect(activeTabs[0]).toHaveAccessibleName(expectedBottomTab);

            const sidebar = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
            const activeSidebarItems = sidebar.getAllByRole('button')
                .filter((item) => item.getAttribute('aria-current') === 'page');
            const expectedSidebarItem = sidebarLabelBySection[section];
            expect(activeSidebarItems, route).toHaveLength(expectedSidebarItem ? 1 : 0);
            if (expectedSidebarItem) {
                expect(activeSidebarItems[0]).toHaveAccessibleName(expectedSidebarItem);
            }
        }
    });

    it.each([
        ['send-picker', 'send'],
        ['receive-picker', 'receive'],
        ['action-detail', 'history'],
        ['cross-chain-order', 'markets'],
        ['market-activity', 'market-activity'],
        ['contract-stake', 'contracts-list'],
        ['list-transfer', 'lists'],
        ['coinpay', 'obligations'],
        ['connected-sites', 'settings'],
        ['wizard', 'create-token'],
        ['addresses', 'addresses'],
        ['account-picker', 'accounts'],
        ['wallet-picker', 'wallets'],
    ])('maps %s to section %s', (view, expected) => {
        expect(activeLeftNavItem(view)).toBe(expected);
        const active = NAV_ITEMS.filter((item) => isNavItemActive(item, view));
        expect(active).toEqual(NAV_ITEMS.includes(expected) ? [expected] : []);
    });

    it('marks the matching LeftNav row on drilldown routes', () => {
        render(<LeftNav currentView="action-detail" onSelect={() => {}} />);
        expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('places Marketplace after DEX and removes both when trading is unavailable', () => {
        const { rerender } = render(<LeftNav currentView="market-activity" onSelect={() => {}} />);
        const labels = screen.getAllByRole('button').map((button) => button.textContent.trim());

        expect(labels.indexOf('Marketplace')).toBe(labels.indexOf('DEX') + 1);
        expect(screen.getByRole('button', { name: 'Marketplace' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Marketplace' })).toHaveAttribute('title', 'Marketplace');

        rerender(<LeftNav currentView="home" onSelect={() => {}} hasDexSurface={false} />);
        expect(screen.queryByRole('button', { name: 'DEX' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Marketplace' })).toBeNull();
    });

    it('marks the matching row without treating More as the current page', () => {
        render(
            <BottomTabBar
                currentView="contract-stake"
                onSelect={() => {}}
                hasVmAddress
            />,
        );
        const more = screen.getByRole('button', { name: 'More' });
        expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
        expect(more).not.toHaveAttribute('aria-current');
        fireEvent.click(more);
        expect(screen.getByRole('button', { name: 'Contracts' })).toHaveAttribute('aria-current', 'page');
    });

    it('marks the More sheet Settings row on Settings routes, as the desktop rail does', () => {
        const { rerender } = render(
            <BottomTabBar currentView="connected-sites" onSelect={() => {}} onOpenSettings={() => {}} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');

        rerender(<BottomTabBar currentView="home" onSelect={() => {}} onOpenSettings={() => {}} />);
        if (!screen.queryByRole('button', { name: 'Settings' })) {
            fireEvent.click(screen.getByRole('button', { name: 'More' }));
        }
        expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current');
    });

    it('does not attribute account management to a different nav item', () => {
        render(<BottomTabBar currentView="account-picker" onSelect={() => {}} />);
        expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('marks Home for the compact menu route in the shared Home group', () => {
        render(<BottomTabBar currentView="menu" onSelect={() => {}} />);
        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current');
    });

    it.each(['receive', 'addresses', 'contacts', 'wizard', 'account-picker', 'wallet-picker'])(
        'does not highlight an unrelated bottom tab on %s',
        (view) => {
            render(<BottomTabBar currentView={view} onSelect={() => {}} />);
            expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
            expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current');
        },
    );

    it('leaves every tab unselected for an unknown screen', () => {
        render(<BottomTabBar currentView="outside-wallet" onSelect={() => {}} />);
        const bottomNavigation = within(screen.getByRole('navigation', { name: 'Bottom navigation' }));
        expect(bottomNavigation.getAllByRole('button')
            .filter((tab) => tab.hasAttribute('aria-current'))).toHaveLength(0);
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

        const receive = screen.getByRole('button', { name: 'Close more navigation' });
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
            'Scan', 'DEX', 'Marketplace', 'Dispensers', 'Contracts', 'Messaging', 'Contacts',
            'Lists', 'Payments due', 'Settings', 'Lock',
            'After navigation',
        ];
        for (const label of order) {
            userEvent.tab();
            expect(screen.getByRole('button', { name: label })).toHaveFocus();
        }
    });
});

describe('Settings account picker navigation', () => {
    it('uses the Settings-specific back label without changing other picker entry points', () => {
        const messaging = { listAccounts: vi.fn().mockResolvedValue([]) };
        const { rerender } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AccountPicker
                    walletId="wallet-1"
                    activeAccountId={null}
                    onSwitch={() => {}}
                    onAddAccount={() => {}}
                    onBack={() => {}}
                    backLabel="Back to settings"
                />
            </MessagingProvider>,
        );

        expect(screen.getByRole('button', { name: 'Back to settings' })).toBeInTheDocument();

        rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <AccountPicker
                    walletId="wallet-1"
                    activeAccountId={null}
                    onSwitch={() => {}}
                    onAddAccount={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeInTheDocument();

        const webApp = readFileSync('packages/web/src/App.jsx', 'utf8');
        expect(webApp).toContain(
            "backLabel={accountPickerBackTo === 'settings' ? t('shell.settings.back') : undefined}",
        );
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
        fireEvent.scroll(main);

        view.rerender(<Route routeKey="action-detail" />);
        expect(document.getElementById('xc-main').scrollTop).toBe(0);
        document.getElementById('xc-main').scrollTop = 73;
        fireEvent.scroll(document.getElementById('xc-main'));

        view.rerender(<Route routeKey="history" />);
        expect(document.getElementById('xc-main').scrollTop).toBe(418);
    });

    it('keeps the offset the user scrolled to when the view swap clamps the body first', () => {
        const view = render(<Route routeKey="settings-list" />);
        const main = document.getElementById('xc-main');
        main.scrollTop = 586;
        fireEvent.scroll(main);
        // The browser clamps the offset to the incoming, shorter content
        // before the outgoing view's cleanup runs; no scroll event yet.
        main.scrollTop = 0;

        view.rerender(<Route routeKey="settings-privacy" />);
        view.rerender(<Route routeKey="settings-list" />);
        expect(document.getElementById('xc-main').scrollTop).toBe(586);
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
    it('labels the three visible header controls and the overflow rows', () => {
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
            ['Lock wallet', 'Lock wallet'],
            ['Open menu', 'Open menu'],
        ];
        for (const [label, title] of expected) {
            expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', title);
        }

        fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
        for (const label of ['Settings', 'Search', 'Scan', 'More wallet actions']) {
            expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
        }
    });
});
