// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Accessibility contract of the wallet menu: the command palette rendered
// with its `menu` prop. Tests that need the catalogue rendering say which
// data attribute they rely on; the harness itself (a palette opened from a
// trigger button) is exercised by the first test so a harness fault cannot
// pass for a missing feature.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { visibleWalletMenu, walletMenuFooter } from '../../../packages/core/src/shared/walletMenu.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const GATES = {
    isSignerMode: false, hasDexSurface: true, hasVmAddress: true, hasBtcAddress: true,
};
const CURRENT_VIEW = 'history';

const commands = [
    { id: 'home', category: 'Navigate', title: 'Home', run: vi.fn() },
    { id: 'send', category: 'Navigate', title: 'Send', run: vi.fn() },
    { id: 'settings', category: 'Settings', title: 'Settings', run: vi.fn() },
    { id: 'settings-network', category: 'Settings', title: 'Settings: network', run: vi.fn() },
];

function MenuHarness() {
    const [open, setOpen] = useState(true);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open wallet menu</button>
            <CommandPalette
                open={open}
                onClose={() => setOpen(false)}
                commands={commands}
                menu={{
                    gates: GATES,
                    currentView: CURRENT_VIEW,
                    onSelect: vi.fn(),
                    onOpenSettings: vi.fn(),
                    onLock: vi.fn(),
                }}
            />
        </>
    );
}

const catalogueRows = () => visibleWalletMenu(GATES).flatMap((group) => group.rows);
const rowEl = (id) => document.querySelector(`[data-wallet-menu-row="${id}"]`);

async function renderMenu() {
    const view = render(<MenuHarness />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    return view;
}

function typeQuery(value) {
    fireEvent.change(screen.getByRole('combobox'), { target: { value } });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('wallet menu accessibility', () => {
    it('harness: the palette opens with a focused combobox and a modal dialog', async () => {
        await renderMenu();
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('has no serious axe violations with an empty query', async () => {
        const { container } = await renderMenu();
        // Relies on data-wallet-menu so a menu-less palette cannot pass.
        expect(container.querySelector('[data-wallet-menu]')).not.toBeNull();
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious axe violations with a query typed', async () => {
        const { container } = await renderMenu();
        typeQuery('set');
        // Relies on data-wallet-menu so a menu-less palette cannot pass.
        expect(container.querySelector('[data-wallet-menu]')).not.toBeNull();
        await expectNoSeriousAxeViolations(container);
    });

    it('names the dialog "Wallet menu"', async () => {
        await renderMenu();
        // Relies on the visually hidden heading that labels the dialog.
        expect(screen.getByRole('dialog', { name: 'Wallet menu' })).toBeInTheDocument();
    });

    it('keeps no visible title text', async () => {
        await renderMenu();
        expect(screen.queryByText('Command palette')).toBeNull();
        expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    });

    it('exposes the search input as a combobox that controls an existing element', async () => {
        await renderMenu();
        const input = screen.getByRole('combobox');
        const controlsId = input.getAttribute('aria-controls');
        expect(controlsId).toBeTruthy();
        expect(document.getElementById(controlsId)).not.toBeNull();
    });

    it('points aria-activedescendant at a result inside the controlled element while results show', async () => {
        await renderMenu();
        typeQuery('set');
        const input = screen.getByRole('combobox');
        const active = document.getElementById(input.getAttribute('aria-activedescendant') || '');
        expect(active).not.toBeNull();
        expect(document.getElementById(input.getAttribute('aria-controls'))).toContainElement(active);
    });

    it('renders every catalogue row as a button named by its label', async () => {
        await renderMenu();
        for (const row of catalogueRows()) {
            // Relies on data-wallet-menu-row="<id>".
            const el = rowEl(row.id);
            expect(el, `row ${row.id}`).not.toBeNull();
            expect(el.tagName).toBe('BUTTON');
            expect(screen.getAllByRole('button', { name: row.label }), `name of ${row.id}`).toContain(el);
        }
    });

    it('renders the footer rows as buttons named by their label', async () => {
        await renderMenu();
        for (const row of walletMenuFooter()) {
            // Relies on data-wallet-menu-row="settings" and "lock".
            const el = rowEl(row.id);
            expect(el, `footer ${row.id}`).not.toBeNull();
            expect(el.tagName).toBe('BUTTON');
            expect(screen.getAllByRole('button', { name: row.label }), `name of ${row.id}`).toContain(el);
        }
    });

    it('boxes each group under a heading', async () => {
        await renderMenu();
        for (const group of visibleWalletMenu(GATES)) {
            // Relies on data-wallet-menu-group="<group id>".
            const box = document.querySelector(`[data-wallet-menu-group="${group.id}"]`);
            expect(box, `group ${group.id}`).not.toBeNull();
            expect(box).toHaveTextContent(group.label);
        }
    });

    it('marks only the current view row with aria-current="page"', async () => {
        await renderMenu();
        // Relies on data-wallet-menu-row and aria-current on the current row.
        expect(rowEl(CURRENT_VIEW)).toHaveAttribute('aria-current', 'page');
        const marked = document.querySelectorAll('[data-wallet-menu-row][aria-current]');
        expect(marked).toHaveLength(1);
    });
});
