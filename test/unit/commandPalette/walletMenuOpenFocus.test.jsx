// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A click on the menu button shows the menu with its scroll surface focused,
// so a long menu scrolls at once; the search shortcut and a keyboard press on
// the menu button still open with the cursor in search, and typing on the
// surface moves to search (operator 2026-11-21 on the extension popup).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    act, cleanup, fireEvent, render, renderHook, screen, waitFor,
} from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import styles from '../../../packages/core/src/shared/commandPalette/CommandPalette.module.css';
import { useCommandPalette } from '../../../packages/core/src/shared/commandPalette/useCommandPalette.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const menu = {
    gates: { hasDexSurface: true, hasVmAddress: true, hasBtcAddress: true },
    currentView: 'home',
    onSelect: vi.fn(),
    onOpenSettings: vi.fn(),
    onLock: vi.fn(),
};

const commands = [
    { id: 'send-command', category: 'Navigate', title: 'Send command', run: vi.fn() },
];

function renderMenu(focusSearch) {
    const view = render(
        <CommandPalette open onClose={() => {}} commands={commands} menu={menu} focusSearch={focusSearch} />,
    );
    const surface = view.container.ownerDocument.querySelector(`.${styles.walletSurface}`);
    const input = screen.getByRole('dialog').querySelector('input[type="search"]');
    return { surface, input };
}

describe('wallet menu open focus', () => {
    it('focuses the scroll surface, not search, when the menu button opened it', async () => {
        const { surface, input } = renderMenu(false);
        expect(surface).not.toBeNull();
        expect(surface).toHaveAttribute('tabindex', '-1');
        await waitFor(() => expect(surface).toHaveFocus());
        expect(input).not.toHaveFocus();
    });

    it('moves to search when a character is typed on the surface', async () => {
        const { surface, input } = renderMenu(false);
        await waitFor(() => expect(surface).toHaveFocus());
        fireEvent.keyDown(surface, { key: 's' });
        expect(input).toHaveFocus();
    });

    it('leaves arrow and modifier keys on the surface for scrolling', async () => {
        const { surface } = renderMenu(false);
        await waitFor(() => expect(surface).toHaveFocus());
        fireEvent.keyDown(surface, { key: 'ArrowDown' });
        fireEvent.keyDown(surface, { key: 'k', metaKey: true });
        expect(surface).toHaveFocus();
    });

    it('keeps the cursor in search when the shortcut opened it', async () => {
        const { input } = renderMenu(true);
        await waitFor(() => expect(input).toHaveFocus());
    });

    it('puts Open in sidebar and Open full screen between search and Lock, then Close', () => {
        const onOpenSidebar = vi.fn();
        const onOpenFullScreen = vi.fn();
        const onClose = vi.fn();
        render(
            <CommandPalette
                open
                onClose={onClose}
                commands={commands}
                menu={{ ...menu, onOpenSidebar, onOpenFullScreen }}
                focusSearch={false}
            />,
        );
        const header = screen.getByRole('dialog').querySelector('header');
        const order = [...header.querySelectorAll('input[type="search"], button')]
            .map((el) => (el.tagName === 'INPUT' ? 'search' : el.getAttribute('aria-label')));
        expect(order).toEqual(['search', 'Open in sidebar', 'Open full screen', 'Lock wallet', 'Close menu']);

        fireEvent.click(screen.getByRole('button', { name: 'Open in sidebar' }));
        expect(onOpenSidebar).toHaveBeenCalledTimes(1);
        expect(onOpenSidebar.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
        expect(onOpenFullScreen).toHaveBeenCalledTimes(1);
    });

    it('offers Open as popup first among the view switches, before Lock and Close', () => {
        // Each view offers the two it is not (operator 2026-11-22): the side
        // panel offers popup and full screen, a full-screen tab popup and sidebar.
        const onOpenPopup = vi.fn();
        const onClose = vi.fn();
        const { unmount } = render(
            <CommandPalette
                open
                onClose={onClose}
                commands={commands}
                menu={{ ...menu, onOpenPopup, onOpenFullScreen: vi.fn() }}
                focusSearch={false}
            />,
        );
        const labels = () => [...screen.getByRole('dialog').querySelector('header').querySelectorAll('input[type="search"], button')]
            .map((el) => (el.tagName === 'INPUT' ? 'search' : el.getAttribute('aria-label')));
        expect(labels()).toEqual(['search', 'Open as popup', 'Open full screen', 'Lock wallet', 'Close menu']);
        fireEvent.click(screen.getByRole('button', { name: 'Open as popup' }));
        expect(onOpenPopup).toHaveBeenCalledTimes(1);
        expect(onOpenPopup.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
        unmount();

        render(
            <CommandPalette
                open
                onClose={vi.fn()}
                commands={commands}
                menu={{ ...menu, onOpenPopup: vi.fn(), onOpenSidebar: vi.fn() }}
                focusSearch={false}
            />,
        );
        expect(labels()).toEqual(['search', 'Open as popup', 'Open in sidebar', 'Lock wallet', 'Close menu']);
    });

    it('shows no view switches when the shell passes none', () => {
        renderMenu(false);
        expect(screen.queryByRole('button', { name: 'Open as popup' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open in sidebar' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open full screen' })).toBeNull();
    });

    it('records the shortcut as a search open and a button as a menu open', () => {
        const { result } = renderHook(() => useCommandPalette());
        const platform = globalThis.navigator?.platform || globalThis.navigator?.userAgent || '';
        const mac = /mac|iphone|ipad|ipod/i.test(platform);
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'k', metaKey: mac, ctrlKey: !mac, bubbles: true,
            }));
        });
        expect(result.current.open).toBe(true);
        expect(result.current.focusSearch).toBe(true);
        act(() => result.current.closePalette());
        act(() => result.current.togglePalette());
        expect(result.current.open).toBe(true);
        expect(result.current.focusSearch).toBe(false);
        act(() => result.current.closePalette());
        act(() => result.current.openPalette());
        expect(result.current.focusSearch).toBe(false);
    });

    it('keeps search focus when Enter or Space on the menu button opened it', () => {
        const { result } = renderHook(() => useCommandPalette());
        act(() => result.current.togglePalette({ detail: 0 }));
        expect(result.current.open).toBe(true);
        expect(result.current.focusSearch).toBe(true);
        act(() => result.current.closePalette());
        act(() => result.current.togglePalette({ detail: 1 }));
        expect(result.current.focusSearch).toBe(false);
        act(() => result.current.closePalette());
        act(() => result.current.openPalette({ detail: 0 }));
        expect(result.current.focusSearch).toBe(true);
    });
});
