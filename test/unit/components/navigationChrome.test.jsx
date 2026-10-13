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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { isNavItemActive, LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';

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

    it('marks More and its matching row for sheet destinations', () => {
        render(
            <BottomTabBar
                currentView="contract-stake"
                onSelect={() => {}}
                hasVmAddress
            />,
        );
        const more = screen.getByRole('button', { name: 'More' });
        expect(more).toHaveAttribute('aria-current', 'page');
        fireEvent.click(more);
        expect(screen.getByRole('button', { name: 'Contracts' })).toHaveAttribute('aria-current', 'page');
    });

    it('marks only More for the compact menu route', () => {
        render(<BottomTabBar currentView="menu" onSelect={() => {}} />);
        expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });
});

describe('More sheet dismissal', () => {
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
        expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull();
        expect(more).toHaveFocus();

        fireEvent.click(more);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(onOpenSettings).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull();
        expect(more).toHaveFocus();
    });

    it('returns focus to More after Escape closes the sheet', () => {
        render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        const more = screen.getByRole('button', { name: 'More' });
        fireEvent.click(more);
        screen.getByRole('button', { name: 'Receive' }).focus();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull();
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
        const lock = screen.getByRole('button', { name: 'Lock' });
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
    it('reaches every bottom tab in visual order', () => {
        render(
            <>
                <button type="button">Before navigation</button>
                <BottomTabBar currentView="home" onSelect={() => {}} />
                <button type="button">After navigation</button>
            </>,
        );
        screen.getByRole('button', { name: 'Before navigation' }).focus();

        for (const label of ['Home', 'History', 'Send', 'Scan', 'More', 'After navigation']) {
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
