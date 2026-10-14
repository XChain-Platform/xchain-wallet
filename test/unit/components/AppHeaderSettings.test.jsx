// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The persistent AppHeader exposes account, wallet, network, and global
// actions without sending the user through an advanced settings route.
// These guards pin the optional settings sections and the compact header's
// labels, tooltips, source order, and width budget.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { FullLayoutWithNav, LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ShortcutHelp } from '../../../packages/core/src/shared/keyboard/ShortcutHelp.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';
import PLATFORM_LINKS from '../../../packages/core/src/shared/platform-links.json';
import { persistActiveNetwork } from '../../../packages/core/src/shared/utils/activeNetworkSwitch.js';
import { readLastView, writeLastView } from '../../../packages/core/src/shared/utils/lastViewMemory.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

let nativeBack;
let capacitorApp;

beforeEach(() => {
    resetBackStackForTests();
    capacitorApp = {
        addListener: vi.fn((_event, listener) => {
            nativeBack = listener;
            return { remove: vi.fn() };
        }),
        minimizeApp: vi.fn(),
    };
    globalThis.Capacitor = { Plugins: { App: capacitorApp } };
});

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];
const appHeaderCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/AppHeader.module.css'),
    'utf8',
);

const gear = () => screen.queryByRole('button', { name: 'Settings' })
    || screen.queryByRole('menuitem', { name: 'Settings' });
const openHeaderMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
const openAppSettings = () => {
    openHeaderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
};

describe('AppHeader settings gear', () => {
    it('renders no gear when no picker and no network filter are wired', () => {
        render(<AppHeader onMenuOpen={() => {}} onLock={() => {}} />);
        openHeaderMenu();
        expect(gear()).toBeNull();
    });

    it('renders settings as a menu row when only the wallet picker is wired', () => {
        render(<AppHeader onOpenWalletPicker={() => {}} />);
        openHeaderMenu();
        expect(gear()).not.toBeNull();
    });

    it('opens full settings from the bottom row of the popover', () => {
        const onOpenSettings = vi.fn();
        render(
            <AppHeader
                activeWallet={{ id: 'w1', name: 'Savings' }}
                onOpenWalletPicker={() => {}}
                onOpenSettings={onOpenSettings}
            />,
        );
        openAppSettings();

        const dialog = screen.getByRole('dialog', { name: 'Wallet settings' });
        const buttons = within(dialog).getAllByRole('button');
        expect(buttons.at(-1)).toHaveTextContent('All settings');

        fireEvent.click(buttons.at(-1));
        expect(onOpenSettings).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog', { name: 'Wallet settings' })).toBeNull();
    });

    it('keeps the watch-only badge in the persistent header', () => {
        render(<AppHeader isWatcherMode />);
        expect(screen.getByRole('status', { name: 'Watch-only wallet' })).toBeTruthy();
        expect(screen.getByText('Watch-only')).toBeTruthy();
    });

    it('renders the gear when only the network filter is wired', () => {
        render(
            <AppHeader
                chainRegistry={chainRegistry}
                coinFamilies={COIN_FAMILIES}
                networkFilter="all"
                onNetworkFilterChange={() => {}}
            />,
        );
        openHeaderMenu();
        expect(gear()).not.toBeNull();
    });

    it('suppresses the network section when showNetworkFilter is false', () => {
        render(
            <AppHeader
                onOpenWalletPicker={() => {}}
                chainRegistry={chainRegistry}
                coinFamilies={COIN_FAMILIES}
                networkFilter="all"
                onNetworkFilterChange={() => {}}
                showNetworkFilter={false}
            />,
        );
        openAppSettings();
        expect(screen.queryByText('Network')).toBeNull();
        expect(screen.getByText('Wallet')).toBeTruthy();
    });

    it('surfaces the active wallet and account, and routes to their pickers', () => {
        const onOpenWalletPicker = vi.fn();
        const onOpenAccountPicker = vi.fn();
        render(
            <AppHeader
                activeWallet={{ id: 'w1', name: 'Savings' }}
                activeAccount={{ id: 'a2', index: 1 }}
                onOpenWalletPicker={onOpenWalletPicker}
                onOpenAccountPicker={onOpenAccountPicker}
            />,
        );
        openAppSettings();

        // Account label falls back to the 1-based hardened index when the
        // account carries no user label.
        expect(screen.getByText('Savings')).toBeTruthy();
        expect(screen.getByText('Account 2')).toBeTruthy();

        fireEvent.click(screen.getByText('Savings'));
        expect(onOpenWalletPicker).toHaveBeenCalledOnce();
        expect(onOpenAccountPicker).not.toHaveBeenCalled();

        // The popover closes on navigation; reopen for the account row.
        fireEvent.click(gear());
        fireEvent.click(screen.getByText('Account 2'));
        expect(onOpenAccountPicker).toHaveBeenCalledOnce();
    });

    it('omits the account section until a wallet is active', () => {
        render(
            <AppHeader
                activeWallet={null}
                activeAccount={{ id: 'a1', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
            />,
        );
        openAppSettings();
        expect(screen.getByText('Wallet')).toBeTruthy();
        expect(screen.queryByText('Account')).toBeNull();
    });
});

describe('AppHeader action row', () => {
    const allActions = {
        onOpenWalletPicker: () => {},
        onCommandPalette: () => {},
        onScan: () => {},
        onManageAddresses: () => {},
        onViewAddress: () => {},
        onLock: () => {},
        onOpenNetworkSettings: () => {},
        activeNetwork: 'mainnet',
        onPopOut: () => {},
        platformCurrent: 'wallet',
        onMenuOpen: () => {},
    };

    it('keeps only lock and menu visible while secondary actions are menu rows', () => {
        render(<AppHeader {...allActions} />);
        const header = screen.getByRole('region', { name: 'App header' });
        const controls = [...header.querySelectorAll('[data-header-control]')];
        const buttons = controls.map((control) => (
            control.matches('button') ? control : control.querySelector('button')
        ));
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
            'Lock wallet',
            'Open menu',
        ]);
        expect(buttons.every((button) => Boolean(button.getAttribute('title')))).toBe(true);
        expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);

        openHeaderMenu();
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(expect.arrayContaining([
            expect.stringContaining('Settings'),
            expect.stringContaining('Search'),
            expect.stringContaining('Scan'),
            expect.stringContaining('Manage addresses'),
            expect.stringContaining('View address'),
            expect.stringContaining('Open in new window'),
            expect.stringContaining('More wallet actions'),
        ]));
        expect(screen.getByRole('menuitem', { name: 'Search' }))
            .toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    });

    it('uses the shared icon-only Button styling for chrome actions', () => {
        render(
            <>
                <AppHeader {...allActions} platformCurrent={undefined} />
                <BottomTabBar currentView="home" onSelect={() => {}} />
            </>,
        );

        const actionNames = ['Lock wallet', 'Open menu'];
        const actionClasses = actionNames.map((name) => screen.getByRole('button', { name }).className);
        expect(new Set(actionClasses).size).toBe(1);
        expect(actionClasses[0]).toMatch(/iconOnly/);

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        expect(screen.getByRole('button', { name: 'Close more navigation' }).className)
            .toBe(actionClasses[0]);
    });

    it('uses shared Buttons for non-destination left-nav actions', () => {
        render(
            <LeftNav
                currentView="home"
                onSelect={() => {}}
                onCommandPalette={() => {}}
                onLock={() => {}}
            />,
        );

        const search = screen.getByRole('button', { name: 'Open command palette' });
        const lock = screen.getByRole('button', { name: 'Lock' });
        expect(search.className).toBe(lock.className);
        expect(search.className).toMatch(/secondary/);
    });

    it('uses the shared icon-only Button for the shortcut help close', () => {
        render(<ShortcutHelp open onClose={() => {}} />);
        const close = screen.getByRole('button', { name: 'Close' });
        expect(close.className).toMatch(/secondary/);
        expect(close.className).toMatch(/iconOnly/);
        expect(close.className).toMatch(/sm/);
    });


    it.each([320, 360, 400])('keeps the logo and buttons in one header row at %dpx', (width) => {
        const originalWidth = window.innerWidth;
        window.innerWidth = width;
        const { container } = render(
            <MessagingProvider
                shell="web"
                messaging={{ getSettings: async () => ({ schemaVersion: 1, activeNetwork: 'mainnet' }) }}
            >
                <FullLayoutWithNav
                    header={(
                        <AppHeader
                            {...allActions}
                            activeWallet={{ id: 'w1', name: 'Main' }}
                            onOpenNetworkSettings={() => {}}
                        />
                    )}
                >
                    <main />
                </FullLayoutWithNav>
            </MessagingProvider>,
        );

        const barRule = /\.bar\s*\{([^}]*)\}/.exec(appHeaderCss)?.[1] || '';
        const leftRule = /\.left\s*\{([^}]*)\}/.exec(appHeaderCss)?.[1] || '';
        const rightRule = /\.right\s*\{([^}]*)\}/.exec(appHeaderCss)?.[1] || '';
        expect(barRule).toMatch(/display:\s*flex/);
        expect(barRule).toMatch(/align-items:\s*center/);
        expect(barRule).toMatch(/justify-content:\s*space-between/);
        expect(barRule).toMatch(/flex-wrap:\s*nowrap/);
        expect(barRule).toMatch(/padding:\s*var\(--xc-space-2\) var\(--xc-space-3\)/);
        expect(barRule).not.toMatch(/(?:min-|max-)?height\s*:/);
        expect(leftRule).toMatch(/flex:\s*1 1 auto/);
        expect(leftRule).toMatch(/min-width:\s*0/);
        expect(rightRule).toMatch(/gap:\s*var\(--xc-space-1\)/);
        expect(rightRule).toMatch(/flex:\s*0 0 auto/);
        expect(rightRule).toMatch(/flex-wrap:\s*nowrap/);
        expect(container.querySelector('[data-xc-tier]')).toHaveAttribute('data-xc-tier', 'compact');
        const header = screen.getByRole('region', { name: 'App header' });
        expect(header.style.flexWrap).toBe('');
        expect(header.children).toHaveLength(2);
        expect(header.firstElementChild).toContainElement(screen.getByAltText('XChain Wallet'));
        expect(header.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Lock wallet' }));
        expect(header.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Open menu' }));
        expect(container.querySelectorAll('[data-header-control]')).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /Network/ })).toBeNull();
        expect(screen.getByText('Wallet: Main')).toBeTruthy();
        window.innerWidth = originalWidth;
    });

    it.each([
        ['web', { ...allActions }],
        ['extension popup', { onCommandPalette: () => {}, onLock: () => {}, onOpenNetworkSettings: () => {}, activeNetwork: 'regtest', onPopOut: () => {} }],
        ['iOS', { onLock: () => {}, onOpenNetworkSettings: () => {}, activeNetwork: 'mainnet' }],
        ['Android', { onLock: () => {}, onOpenNetworkSettings: () => {}, activeNetwork: 'testnet' }],
        ['desktop', { onCommandPalette: () => {}, onLock: () => {}, onOpenNetworkSettings: () => {}, activeNetwork: 'mainnet' }],
    ])('%s shell has at most two visible controls on the right', (_shell, props) => {
        const { container } = render(<AppHeader {...props} />);
        expect(container.querySelectorAll('[data-header-control]').length).toBeLessThanOrEqual(2);
    });

    it('offers pop-out on web-capable surfaces and suppresses it in native and desktop apps', () => {
        render(<AppHeader onPopOut={() => {}} />);
        openHeaderMenu();
        expect(screen.getByRole('menuitem', { name: 'Open in new window' })).toBeTruthy();

        cleanup();
        vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
        render(<AppHeader onPopOut={() => {}} />);
        openHeaderMenu();
        expect(screen.queryByRole('menuitem', { name: 'Open in new window' })).toBeNull();

        cleanup();
        vi.unstubAllGlobals();
        vi.stubGlobal('xchainWalletWindow', {});
        render(<AppHeader onPopOut={() => {}} />);
        openHeaderMenu();
        expect(screen.queryByRole('menuitem', { name: 'Open in new window' })).toBeNull();
    });

    it('keeps phone-hidden actions reachable from bottom navigation', () => {
        const onCommandPalette = vi.fn();
        render(
            <BottomTabBar
                currentView="home"
                onSelect={() => {}}
                onOpenSettings={() => {}}
                onCommandPalette={onCommandPalette}
                platformCurrent="wallet"
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));
        expect(onCommandPalette).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
        for (const site of PLATFORM_LINKS.links.filter((entry) => entry.key !== 'wallet')) {
            const link = screen.getByRole('link', { name: site.label });
            expect(link).toHaveAttribute('href', site.href);
            expect(link).toHaveAttribute('target', '_blank');
        }
    });

    it('returns focus to the header trigger when Escape closes its menu', () => {
        render(<AppHeader onScan={() => {}} onManageAddresses={() => {}} />);
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.click(trigger);
        const item = screen.getByRole('menuitem', { name: 'Scan' });
        item.focus();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('closes the scan menu on Android Back instead of minimizing the app', () => {
        render(<AppHeader onScan={() => {}} onManageAddresses={() => {}} />);
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeInTheDocument();

        act(() => nativeBack({ canGoBack: false }));

        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });
});

describe('HeaderSettingsButton section gating', () => {
    it('closes the settings popover on Android Back instead of minimizing the app', () => {
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
            />,
        );
        const trigger = gear();
        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Wallet settings' })).toBeInTheDocument();

        act(() => nativeBack({ canGoBack: false }));

        expect(screen.queryByRole('dialog', { name: 'Wallet settings' })).toBeNull();
        expect(trigger).toHaveFocus();
        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });

    it('renders without a network section when the filter props are absent', () => {
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
            />,
        );
        fireEvent.click(gear());
        expect(screen.queryByText('Network')).toBeNull();
        expect(screen.getByText('Main')).toBeTruthy();
    });

    it('renders the network section and reports changes when fully wired', () => {
        const onNetworkFilterChange = vi.fn();
        render(
            <HeaderSettingsButton
                chainRegistry={chainRegistry}
                coinFamilies={COIN_FAMILIES}
                networkFilter="all"
                onNetworkFilterChange={onNetworkFilterChange}
            />,
        );
        fireEvent.click(gear());
        expect(screen.getByText('Chain filter')).toBeTruthy();
        const networkTrigger = screen.getByRole('button', { expanded: false, name: /All networks/ });
        expect(networkTrigger).toHaveAttribute('title', 'All networks');
        fireEvent.click(networkTrigger);
        const litecoin = screen.getByRole('option', { name: /Litecoin/ });
        expect(litecoin).toHaveAttribute('title', 'Litecoin');
        fireEvent.click(litecoin);
        expect(onNetworkFilterChange).toHaveBeenCalledWith('litecoin');
    });

    it('confirms an active network switch from settings', async () => {
        const onActiveNetworkChange = vi.fn().mockResolvedValue(undefined);
        const nativeConfirm = vi.spyOn(window, 'confirm');
        render(
            <HeaderSettingsButton
                activeNetwork="testnet"
                developerMode
                onActiveNetworkChange={onActiveNetworkChange}
            />,
        );

        fireEvent.click(gear());
        fireEvent.change(screen.getByLabelText('Active network in header'), {
            target: { value: 'regtest' },
        });

        const dialog = screen.getByRole('dialog', { name: 'Switch to Regtest?' });
        expect(dialog).toHaveTextContent('Unlock the wallet again after it reloads.');
        expect(nativeConfirm).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Switch network' }));

        await waitFor(() => expect(onActiveNetworkChange).toHaveBeenCalledWith('regtest'));
    });

    it('does not guess a network badge before settings load', () => {
        render(
            <HeaderSettingsButton
                activeNetwork={undefined}
                onActiveNetworkChange={() => Promise.resolve()}
            />,
        );

        expect(screen.queryByLabelText(/Active network:/)).toBeNull();
    });

    it('keeps the current network when the header confirmation is cancelled', async () => {
        const onActiveNetworkChange = vi.fn();
        render(
            <HeaderSettingsButton
                activeNetwork="mainnet"
                onActiveNetworkChange={onActiveNetworkChange}
            />,
        );

        fireEvent.click(gear());
        const select = screen.getByLabelText('Active network in header');
        expect(Array.from(select.options, (option) => option.value)).toEqual(['mainnet', 'testnet']);
        fireEvent.change(select, { target: { value: 'testnet' } });
        const dialog = screen.getByRole('dialog', { name: 'Switch to Testnet?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(dialog).not.toBeInTheDocument());
        expect(onActiveNetworkChange).not.toHaveBeenCalled();
        expect(select.value).toBe('mainnet');
    });

    it('clears a stale destination after persisting a network switch', async () => {
        const walletId = 'network-switch-wallet';
        writeLastView(walletId, 'contacts');
        const setActiveNetwork = vi.fn().mockResolvedValue({ activeNetwork: 'testnet' });

        await persistActiveNetwork({
            messaging: { setActiveNetwork },
            walletId,
            network: 'testnet',
        });

        expect(setActiveNetwork).toHaveBeenCalledWith({ walletId, network: 'testnet' });
        expect(readLastView(walletId)).toBeNull();
    });

    it('keeps the saved destination when network persistence fails', async () => {
        const walletId = 'failed-network-switch-wallet';
        writeLastView(walletId, 'contacts');

        await expect(persistActiveNetwork({
            messaging: { setActiveNetwork: vi.fn().mockRejectedValue(new Error('offline')) },
            walletId,
            network: 'testnet',
        })).rejects.toThrow('offline');

        expect(readLastView(walletId)).toBe('contacts');
        writeLastView(walletId, 'home');
    });

    it('marks the trigger active when a non-default wallet or account is selected', () => {
        const { rerender } = render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
            />,
        );
        expect(gear()).not.toHaveAttribute('data-active');

        rerender(
            <HeaderSettingsButton
                activeWallet={{ id: 'w2', name: 'Second' }}
                onOpenWalletPicker={() => {}}
                walletNonDefault
            />,
        );
        expect(gear()).toHaveAttribute('data-active', 'true');
    });

    it('returns focus to the settings trigger when Escape closes its popover', () => {
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
            />,
        );
        const trigger = gear();
        fireEvent.click(trigger);
        const wallet = screen.getByRole('button', { name: 'Main' });
        expect(wallet).toHaveAttribute('title', 'Main');
        wallet.focus();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('does not treat a stale network filter as active when the section is unwired', () => {
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
                networkFilter="litecoin"
            />,
        );
        expect(gear()).not.toHaveAttribute('data-active');
        cleanup();
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
                networkFilter="all"
            />,
        );
        expect(gear()).not.toHaveAttribute('data-active');
    });
});

describe('network status', () => {
    it('does not render a network control in the toolbar', () => {
        render(
            <AppHeader
                activeNetwork="regtest"
                onOpenNetworkSettings={() => {}}
            />,
        );
        expect(screen.queryByRole('button', { name: /Network/ })).toBeNull();
    });
});
