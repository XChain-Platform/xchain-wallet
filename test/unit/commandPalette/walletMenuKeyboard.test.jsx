// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keyboard behaviour of the wallet menu (the command palette with its `menu`
// prop). The search input may keep focus and steer rows through
// aria-activedescendant, or focus may rove onto the row buttons; the helpers
// read the current row either way.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { visibleWalletMenu } from '../../../packages/core/src/shared/walletMenu.js';

const GATES = {
    isSignerMode: false, hasDexSurface: true, hasVmAddress: true, hasBtcAddress: true,
};

const commands = [
    { id: 'home', category: 'Navigate', title: 'Home', run: vi.fn() },
    { id: 'settings', category: 'Settings', title: 'Settings', run: vi.fn() },
];

const onLock = vi.fn();

function MenuHarness() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open wallet menu</button>
            <CommandPalette
                open={open}
                onClose={() => setOpen(false)}
                commands={commands}
                menu={{
                    gates: GATES,
                    currentView: 'home',
                    onSelect: vi.fn(),
                    onOpenSettings: vi.fn(),
                    onLock,
                }}
            />
        </>
    );
}

const opener = () => screen.getByRole('button', { name: 'Open wallet menu' });

async function openMenu() {
    render(<MenuHarness />);
    opener().focus();
    fireEvent.click(opener());
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
}

/** The row the keyboard is on: focused row button, else the active descendant. */
function currentRow() {
    const focused = document.activeElement;
    const own = focused?.closest?.('[data-wallet-menu-row]');
    if (own) return own;
    const id = screen.queryByRole('combobox')?.getAttribute('aria-activedescendant');
    const target = id ? document.getElementById(id) : null;
    return target?.closest?.('[data-wallet-menu-row]') || null;
}

const press = (key, init = {}) => fireEvent.keyDown(document.activeElement, { key, ...init });

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('wallet menu keyboard', () => {
    it('harness: opening from a trigger moves focus to the search combobox', async () => {
        await openMenu();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on Escape and returns focus to the element focused before opening', async () => {
        await openMenu();
        press('Escape');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(opener()).toHaveFocus());
    });

    it('keeps Tab and Shift+Tab inside the dialog and makes the page behind it inert', async () => {
        await openMenu();
        const dialog = screen.getByRole('dialog');
        // Relies on data-wallet-menu-row buttons being focusable in the dialog.
        const stops = Array.from(dialog.querySelectorAll('button:not([tabindex="-1"]), input'));
        expect(stops.length).toBeGreaterThan(1);

        stops[stops.length - 1].focus();
        fireEvent.keyDown(document.activeElement, { key: 'Tab' });
        expect(dialog).toContainElement(document.activeElement);

        stops[0].focus();
        fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
        expect(dialog).toContainElement(document.activeElement);
        expect(opener()).toHaveAttribute('inert');
    });

    it('moves between catalogue rows with ArrowDown and ArrowUp on an empty query', async () => {
        await openMenu();
        // Relies on data-wallet-menu-row for the empty-query catalogue.
        const first = currentRow();
        expect(first, 'a catalogue row is current on open').not.toBeNull();

        press('ArrowDown');
        const second = currentRow();
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);

        press('ArrowUp');
        expect(currentRow()).toBe(first);
    });

    it('starts on the first catalogue row', async () => {
        await openMenu();
        const [firstGroup] = visibleWalletMenu(GATES);
        // Relies on data-wallet-menu-row.
        expect(currentRow()).toHaveAttribute('data-wallet-menu-row', firstGroup.rows[0].id);
    });

    it('reaches Lock wallet by keyboard and activates it', async () => {
        await openMenu();
        const rowCount = document.querySelectorAll('[data-wallet-menu-row]').length;
        let reached = false;
        for (let i = 0; i <= rowCount; i += 1) {
            if (currentRow()?.getAttribute('data-wallet-menu-row') === 'lock') { reached = true; break; }
            press('ArrowDown');
        }
        // Relies on data-wallet-menu-row="lock".
        expect(reached, 'ArrowDown reaches the lock row').toBe(true);

        press('Enter');
        // A focused button activates on Enter in a browser; jsdom does not.
        if (!onLock.mock.calls.length && document.activeElement?.tagName === 'BUTTON') {
            fireEvent.click(document.activeElement);
        }
        expect(onLock).toHaveBeenCalledTimes(1);
    });
});
