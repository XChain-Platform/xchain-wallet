// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import {
    buildCommands,
    parseFreeformCommands,
    settingsSectionsToCommands,
} from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const fullGates = {
    hasDexSurface: true,
    hasVmAddress: true,
    hasBtcAddress: true,
};

function renderMenu(overrides = {}) {
    const onClose = overrides.onClose || vi.fn();
    const menu = {
        gates: fullGates,
        currentView: 'home',
        onSelect: vi.fn(),
        onOpenSettings: vi.fn(),
        onLock: vi.fn(),
        ...overrides.menu,
    };
    const commands = overrides.commands || [
        { id: 'settings-command', category: 'Menu', title: 'Settings command', run: vi.fn() },
        { id: 'send-command', category: 'Navigate', title: 'Send command', run: vi.fn() },
    ];
    const view = render(
        <CommandPalette
            open
            onClose={onClose}
            commands={commands}
            parseQuery={overrides.parseQuery}
            menu={menu}
        />,
    );
    return {
        ...view, onClose, menu, commands,
    };
}

function integratedCommands() {
    return [
        ...buildCommands({ navigate() {}, lock() {}, ...fullGates }),
        ...settingsSectionsToCommands({ openSettings() {} }),
    ];
}

describe('CommandPalette wallet menu surface', () => {
    it('renders group boxes in catalogue order with footer rows', () => {
        const { container } = renderMenu();
        const root = screen.getByRole('dialog', { name: 'Wallet menu' });
        const groups = Array.from(container.querySelectorAll('[data-wallet-menu-group]'));

        expect(root).toHaveAttribute('data-wallet-menu', '');
        expect(groups.map((group) => group.getAttribute('data-wallet-menu-group'))).toEqual([
            'wallet', 'trade', 'manage', 'people',
        ]);
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
            'data-wallet-menu-row',
            'settings',
        );
        expect(screen.getByRole('button', { name: 'Lock wallet' })).toHaveAttribute(
            'data-wallet-menu-row',
            'lock',
        );
        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Search the wallet');
    });

    it('closes before catalogue and footer callbacks run', () => {
        const order = [];
        const { menu } = renderMenu({
            onClose: vi.fn(() => order.push('close')),
            menu: {
                onSelect: vi.fn((id) => order.push(`select:${id}`)),
                onOpenSettings: vi.fn(() => order.push('settings')),
                onLock: vi.fn(() => order.push('lock')),
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Lock wallet' }));

        expect(order).toEqual([
            'close', 'select:send',
            'close', 'settings',
            'close', 'lock',
        ]);
        expect(menu.onSelect).toHaveBeenCalledWith('send');
        expect(menu.onOpenSettings).toHaveBeenCalledOnce();
        expect(menu.onLock).toHaveBeenCalledOnce();
    });

    it('hides Lock without an onLock callback', () => {
        renderMenu({ menu: { onLock: undefined } });
        expect(screen.queryByRole('button', { name: 'Lock wallet' })).toBeNull();
    });

    it('drops Send and Receive in signer mode', () => {
        renderMenu({ menu: { gates: { ...fullGates, isSignerMode: true } } });
        expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
        expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
    });

    it('uses reading order for arrow keys and Enter', () => {
        const { menu } = renderMenu({ menu: { currentView: 'send' } });
        const input = screen.getByRole('combobox');

        expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute(
            'data-wallet-menu-focused',
            '',
        );
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(screen.getByRole('button', { name: 'Receive' })).toHaveAttribute(
            'data-wallet-menu-focused',
            '',
        );
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(menu.onSelect).toHaveBeenCalledWith('receive');
    });

    it('swaps the catalogue for filtered commands and Enter runs the top hit', () => {
        const order = [];
        const topRun = vi.fn(() => order.push('run'));
        const { container } = renderMenu({
            onClose: vi.fn(() => order.push('close')),
            commands: [
                { id: 'settings-command', category: 'Menu', title: 'Settings', run: topRun },
                { id: 'send-command', category: 'Navigate', title: 'Send', run: vi.fn() },
            ],
        });
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'set' } });
        expect(container.querySelector('[data-wallet-menu-group]')).toBeNull();
        expect(screen.getAllByRole('option')[0]).toHaveTextContent('Settings');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(order).toEqual(['close', 'run']);
        expect(topRun).toHaveBeenCalledOnce();
    });

    it('groups set matches as Menu, In Settings, then In All actions', () => {
        renderMenu({ commands: integratedCommands() });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'set' } });

        expect(screen.getAllByRole('option').map((row) => row.id)).toEqual([
            'xc-cmd-nav-settings',
            'xc-cmd-settings-this-wallet',
            'xc-cmd-settings-safety',
            'xc-cmd-settings-network',
            'xc-cmd-create-bridge-settings',
            'xc-cmd-create-mint-settings',
        ]);
        const headings = ['Menu', 'In Settings', 'In All actions']
            .map((label) => screen.getByText(label));
        expect(headings[0].compareDocumentPosition(headings[1]))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(headings[1].compareDocumentPosition(headings[2]))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('puts Receive first for rec', () => {
        renderMenu({ commands: integratedCommands() });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rec' } });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('id', 'xc-cmd-nav-receive');
    });

    it('keeps a matching footer row in the Menu group', () => {
        renderMenu({ commands: integratedCommands() });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lock' } });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('id', 'xc-cmd-wallet-lock');
        expect(screen.getByText('Menu')).toBeTruthy();
    });

    it('keeps a parsed send intent above every grouped result', () => {
        const composeSend = vi.fn();
        renderMenu({
            commands: integratedCommands(),
            parseQuery: (query) => parseFreeformCommands(query, { composeSend }),
        });
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'send 1 BTC' } });
        expect(screen.getAllByRole('option')[0]).toHaveTextContent('Send 1 BTC');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(composeSend).toHaveBeenCalledWith({ amount: '1', tick: 'BTC' });
    });

    it('shows neither a Recent group nor unread badge UI for an empty query', () => {
        const { container } = renderMenu();

        expect(screen.queryByText('Recent')).toBeNull();
        expect(container.querySelector('[data-unread]')).toBeNull();
        expect(container.querySelector('[aria-label*="unread" i]')).toBeNull();
        expect(container.querySelector('[class*="badge" i]')).toBeNull();
    });
});
