// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Arrow-key model for role="menu" / role="listbox" popups, installed once per
// shell.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';
import { useState } from 'react';
import { nextMenuIndex, useMenuKeys } from '../../../packages/core/src/shared/keyboard/useMenuKeys.js';

afterEach(() => cleanup());

function Popup({ withSearch = false, navigateOnSelect = false }) {
    useMenuKeys();
    const [open, setOpen] = useState(false);
    const [navigated, setNavigated] = useState(false);
    if (navigated) return <main><h1>Chosen destination</h1></main>;
    return (
        <div>
            <button
                type="button"
                data-testid="trigger"
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            >
                menu
            </button>
            {open ? (
                <div role="listbox" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
                    {withSearch ? <input aria-label="find" /> : null}
                    {['one', 'two', 'three'].map((n) => (
                        <button
                            key={n}
                            type="button"
                            role="option"
                            aria-selected={n === 'two' ? 'true' : 'false'}
                            onClick={() => {
                                setOpen(false);
                                if (navigateOnSelect) setNavigated(true);
                            }}
                        >
                            {n}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe('nextMenuIndex', () => {
    it('wraps and jumps', () => {
        expect(nextMenuIndex('ArrowDown', 2, 3)).toBe(0);
        expect(nextMenuIndex('ArrowUp', 0, 3)).toBe(2);
        expect(nextMenuIndex('ArrowDown', -1, 3)).toBe(0);
        expect(nextMenuIndex('ArrowUp', -1, 3)).toBe(2);
        expect(nextMenuIndex('Home', 2, 3)).toBe(0);
        expect(nextMenuIndex('End', 0, 3)).toBe(2);
        expect(nextMenuIndex('a', 0, 3)).toBeNull();
        expect(nextMenuIndex('ArrowDown', 0, 0)).toBeNull();
    });
});

describe('useMenuKeys', () => {
    it('keeps one option in the tab order while arrow and jump keys move it', async () => {
        const user = userEvent.setup();
        render(<Popup />);
        const trigger = screen.getByTestId('trigger');
        trigger.focus();
        fireEvent.click(trigger);
        const options = screen.getAllByRole('option');

        await waitFor(() => expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]));
        await user.tab();
        expect(options[1]).toHaveFocus();
        fireEvent.keyDown(options[1], { key: 'ArrowDown' });
        expect(options[2]).toHaveFocus();
        expect(options.map((option) => option.tabIndex)).toEqual([-1, -1, 0]);
        fireEvent.keyDown(options[2], { key: 'Home' });
        expect(options[0]).toHaveFocus();
        fireEvent.keyDown(options[0], { key: 'End' });
        expect(options[2]).toHaveFocus();
    });

    it('moves from the opener to the selected item, then between items', () => {
        render(<Popup />);
        const trigger = screen.getByTestId('trigger');
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('option', { name: 'two' }));
        fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('option', { name: 'three' }));
        fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('option', { name: 'one' }));
        fireEvent.keyDown(document.activeElement, { key: 'End' });
        expect(document.activeElement).toBe(screen.getByRole('option', { name: 'three' }));
        fireEvent.keyDown(document.activeElement, { key: 'Home' });
        expect(document.activeElement).toBe(screen.getByRole('option', { name: 'one' }));
    });

    it('moves from a search box to the first item and leaves its caret keys alone', () => {
        render(<Popup withSearch />);
        const trigger = screen.getByTestId('trigger');
        fireEvent.click(trigger);
        const find = screen.getByLabelText('find');
        find.focus();
        fireEvent.keyDown(find, { key: 'Home' });
        expect(document.activeElement).toBe(find);
        fireEvent.keyDown(find, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('option', { name: 'one' }));
    });

    it('returns focus to the opener when Escape closes the popup', async () => {
        render(<Popup />);
        const trigger = screen.getByTestId('trigger');
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const item = document.activeElement;
        fireEvent.keyDown(item, { key: 'Escape' });
        await flush();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('returns focus to the opener after an item is chosen with Enter', async () => {
        render(<Popup />);
        const trigger = screen.getByTestId('trigger');
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const item = document.activeElement;
        fireEvent.keyDown(item, { key: 'Enter' });
        fireEvent.click(item);
        await flush();
        expect(document.activeElement).toBe(trigger);
    });

    it('returns focus to the opener after an item is chosen with a pointer', async () => {
        render(<Popup />);
        const trigger = screen.getByTestId('trigger');
        trigger.focus();
        fireEvent.click(trigger);
        const item = screen.getByRole('option', { name: 'one' });
        item.focus();

        fireEvent.click(item);
        await flush();

        expect(document.activeElement).toBe(trigger);
    });

    it('focuses the destination heading when selection removes the opener', async () => {
        render(<Popup navigateOnSelect />);
        fireEvent.click(screen.getByTestId('trigger'));
        const item = screen.getByRole('option', { name: 'one' });
        item.focus();

        fireEvent.click(item);
        await flush();

        expect(screen.getByRole('heading', { name: 'Chosen destination' })).toHaveFocus();
    });

    it('ignores arrows outside a popup', () => {
        render(<div><Popup /><button data-testid="plain">x</button></div>);
        const plain = screen.getByTestId('plain');
        plain.focus();
        fireEvent.keyDown(plain, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(plain);
    });
});
