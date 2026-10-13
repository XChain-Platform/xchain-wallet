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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';
import PLATFORM_LINKS from '../../../packages/core/src/shared/platform-links.json';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];
const appHeaderCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/AppHeader.module.css'),
    'utf8',
);

const gear = () => screen.queryByRole('button', { name: 'Settings' });

describe('AppHeader settings gear', () => {
    it('renders no gear when no picker and no network filter are wired', () => {
        render(<AppHeader onMenuOpen={() => {}} onLock={() => {}} />);
        expect(gear()).toBeNull();
    });

    it('renders the gear when only the wallet picker is wired', () => {
        render(<AppHeader onOpenWalletPicker={() => {}} />);
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
        fireEvent.click(gear());

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
        fireEvent.click(gear());
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
        fireEvent.click(gear());

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
        fireEvent.click(gear());
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
        platformCurrent: 'wallet',
        onMenuOpen: () => {},
    };

    it('gives every icon action a label and tooltip in a sensible focus order', () => {
        render(<AppHeader {...allActions} />);
        const header = screen.getByRole('region', { name: 'App header' });
        const buttons = within(header).getAllByRole('button');

        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
            'Settings',
            'Open command palette',
            'Scan and addresses',
            'Lock wallet',
            'XChain platform sites',
            'Open menu',
        ]);
        expect(buttons.every((button) => Boolean(button.getAttribute('title')))).toBe(true);
        expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);
    });

    it('keeps only network state, lock and menu in one header row at 360px', () => {
        const originalWidth = window.innerWidth;
        window.innerWidth = 360;
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

        const rightRule = /\.right\s*\{([^}]*)\}/.exec(appHeaderCss)?.[1] || '';
        expect(rightRule).toMatch(/gap:\s*var\(--xc-space-1\)/);
        expect(rightRule).toMatch(/flex-wrap:\s*nowrap/);
        const phoneRule = /@media \(max-width: (\d+)px\)\s*\{([\s\S]*)\}\s*$/.exec(appHeaderCss);
        expect(phoneRule).not.toBeNull();
        expect(Number(phoneRule[1])).toBe(479);
        expect(phoneRule[2]).toMatch(/\.bar\.phoneCondensed\s*\{[^}]*flex-wrap:\s*nowrap/s);
        expect(phoneRule[2]).toMatch(/\.right\s*\{[^}]*flex:\s*0 0 auto/s);
        expect(phoneRule[2]).toMatch(/\.phoneCondensed \.phoneHidden\s*\{[^}]*display:\s*none/s);
        expect(container.querySelector('[data-xc-tier]')).toHaveAttribute('data-xc-tier', 'compact');
        expect(screen.getByRole('region', { name: 'App header' }).style.flexWrap).toBe('');

        const secondary = [...container.querySelectorAll('[data-phone-secondary-action]')];
        expect(secondary).toHaveLength(4);
        expect(secondary.flatMap((slot) => [...slot.querySelectorAll('button')]
            .map((button) => button.getAttribute('aria-label')))).toEqual([
            'Settings',
            'Open command palette',
            'Scan and addresses',
            'XChain platform sites',
        ]);
        expect(screen.getByRole('button', { name: 'Checking network' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Lock wallet' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
        expect(screen.getByText('Wallet: Main')).toBeTruthy();
        expect([360, 412].every((width) => width <= Number(phoneRule[1]))).toBe(true);
        expect(480).toBeGreaterThan(Number(phoneRule[1]));
        window.innerWidth = originalWidth;
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

    it('returns focus to the scan trigger when Escape closes its menu', () => {
        render(<AppHeader onScan={() => {}} onManageAddresses={() => {}} />);
        const trigger = screen.getByRole('button', { name: 'Scan and addresses' });
        fireEvent.click(trigger);
        const item = screen.getByRole('menuitem', { name: 'Scan' });
        expect(item).toHaveAttribute('title', 'Scan');
        item.focus();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});

describe('HeaderSettingsButton section gating', () => {
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

    it('shows the active network badge and confirms a header switch', async () => {
        const onActiveNetworkChange = vi.fn().mockResolvedValue(undefined);
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(
            <HeaderSettingsButton
                activeNetwork="testnet"
                developerMode
                onActiveNetworkChange={onActiveNetworkChange}
            />,
        );

        expect(screen.getByLabelText('Active network: Testnet').textContent).toBe('Testnet');
        fireEvent.click(gear());
        fireEvent.change(screen.getByLabelText('Active network in header'), {
            target: { value: 'regtest' },
        });

        expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/refresh balances and history for Regtest/));
        expect(onActiveNetworkChange).toHaveBeenCalledWith('regtest');
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

    it('keeps the current network when the header confirmation is cancelled', () => {
        const onActiveNetworkChange = vi.fn();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
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

        expect(onActiveNetworkChange).not.toHaveBeenCalled();
        expect(select.value).toBe('mainnet');
    });

    it('marks the trigger active when a non-default wallet or account is selected', () => {
        const { rerender } = render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
            />,
        );
        const plain = gear().className;

        rerender(
            <HeaderSettingsButton
                activeWallet={{ id: 'w2', name: 'Second' }}
                onOpenWalletPicker={() => {}}
                walletNonDefault
            />,
        );
        expect(gear().className).not.toBe(plain);
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
        const plain = gear().className;
        cleanup();
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
                networkFilter="all"
            />,
        );
        expect(gear().className).toBe(plain);
    });
});

describe('header network badge width', () => {
    const badgeCss = readFileSync(
        join(process.cwd(), 'packages/core/src/shared/components/HeaderSettingsButton.module.css'),
        'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const rulesFor = (selector) => [...badgeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel]) => sel.trim() === selector)
        .map(([, , body]) => body);

    it('never shrinks the badge below its text', () => {
        const base = rulesFor('.networkBadge');
        expect(base.length).toBeGreaterThan(0);
        expect(base[0]).toMatch(/flex:\s*0 0 auto/);
        expect(base[0]).toMatch(/white-space:\s*nowrap/);
        // A fixed width with overflow hidden is what rendered "Ma" and "Re".
        for (const body of base) {
            expect(body).not.toMatch(/(^|[^-])width:/);
            expect(body).not.toMatch(/overflow/);
        }
    });

    it('falls back to a dot with a hidden name, not clipped letters, at phone width', () => {
        const narrow = /@media not all and \(min-width: (\d+)px\)\s*\{([\s\S]*?)\n\}/.exec(badgeCss);
        expect(narrow).not.toBeNull();
        expect(Number(narrow[1])).toBeGreaterThanOrEqual(400);
        expect(narrow[2]).toMatch(/\.networkBadgeDot\s*\{[^}]*display:\s*inline-block/);
        expect(narrow[2]).toMatch(/\.networkBadgeText\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/);
        expect(rulesFor('.networkBadgeDot')[0]).toMatch(/display:\s*none/);
    });

    it.each([
        ['mainnet', 'Mainnet'],
        ['regtest', 'Regtest'],
    ])('keeps the full %s name in the badge text and its accessible name', (network, label) => {
        render(
            <HeaderSettingsButton
                activeNetwork={network}
                developerMode
                onActiveNetworkChange={() => Promise.resolve()}
            />,
        );
        const badge = screen.getByLabelText(`Active network: ${label}`);
        expect(badge.getAttribute('title')).toBe(`Active network: ${label}`);
        expect(badge.textContent).toBe(label);
        const [dot, text] = badge.children;
        expect(dot.getAttribute('aria-hidden')).toBe('true');
        expect(dot.textContent).toBe('');
        expect(text.textContent).toBe(label);
    });
});
