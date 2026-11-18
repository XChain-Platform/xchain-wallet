// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/styles/useLayoutTier.js', () => ({
    useLayoutTier: () => [() => {}, 'full'],
}));

import {
    FullLayoutWithNav,
    LeftNav,
} from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { useCommandPalette } from '../../../packages/core/src/shared/commandPalette/useCommandPalette.js';
import { ShortcutHelp } from '../../../packages/core/src/shared/keyboard/ShortcutHelp.jsx';
import { useKeyboardShortcuts } from '../../../packages/core/src/shared/keyboard/useKeyboardShortcuts.js';

afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
});

const commands = (navigate) => [
    { id: 'home', category: 'Navigate', title: 'Home', run: () => navigate('home') },
    { id: 'send', category: 'Navigate', title: 'Send', run: () => navigate('send') },
];

function DesktopKeyboardShell() {
    const [view, setView] = useState('home');
    const [helpOpen, setHelpOpen] = useState(false);
    const palette = useCommandPalette({
        enabled: !helpOpen,
        navigate: setView,
        currentView: view,
    });
    useKeyboardShortcuts({
        enabled: !palette.open && !helpOpen,
        handlers: {
            navigate: setView,
            openHelp: () => setHelpOpen(true),
        },
    });

    return (
        <FullLayoutWithNav
            routeKey={`${view}:${palette.navigationKey}`}
            nav={(
                <LeftNav
                    currentView={view}
                    onSelect={setView}
                />
            )}
        >
            <main id="xc-main" tabIndex={-1}>
                <h1>{view === 'home' ? 'Home' : 'History'}</h1>
            </main>
            <CommandPalette
                open={palette.open}
                onClose={palette.closePalette}
                commands={commands(palette.navigate)}
            />
            <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        </FullLayoutWithNav>
    );
}

const flushFocus = () => act(async () => {
    await new Promise((resolveFocus) => setTimeout(resolveFocus, 30));
});

// Browsers dispatch a detail-zero click when Enter activates a link or button.
function pressEnter(control) {
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.click(control, { detail: 0 });
    fireEvent.keyUp(control, { key: 'Enter' });
}

describe('desktop renderer keyboard shell', () => {
    it('reaches main through the skip link and operates the side nav with arrows', () => {
        render(<DesktopKeyboardShell />);
        const skip = screen.getByRole('link', { name: 'Skip to main content' });
        skip.focus();
        pressEnter(skip);
        expect(document.getElementById('xc-main')).toHaveFocus();

        // The side menu has no Search row (U99, operator 2026-11-18): Home is its first stop.
        expect(screen.queryByRole('button', { name: 'Open the wallet menu' })).toBeNull();
        const home = screen.getByRole('button', { name: 'Home' });
        const send = screen.getByRole('button', { name: 'Send' });
        const receive = screen.getByRole('button', { name: 'Receive' });
        const myTokens = screen.getByRole('button', { name: 'My Tokens' });
        const history = screen.getByRole('button', { name: 'History' });
        const nav = screen.getByRole('navigation');
        const navButtons = [...nav.querySelectorAll('button:not(:disabled)')];
        expect(navButtons[0]).toBe(home);
        home.focus();
        fireEvent.keyDown(home, { key: 'ArrowUp' });
        expect(navButtons.at(-1)).toHaveFocus();
        navButtons.at(-1).focus();
        fireEvent.keyDown(navButtons.at(-1), { key: 'ArrowDown' });
        expect(home).toHaveFocus();
        fireEvent.keyDown(home, { key: 'ArrowDown' });
        expect(send).toHaveFocus();
        fireEvent.keyDown(send, { key: 'ArrowDown' });
        expect(receive).toHaveFocus();
        fireEvent.keyDown(receive, { key: 'ArrowDown' });
        expect(myTokens).toHaveFocus();
        fireEvent.keyDown(myTokens, { key: 'ArrowDown' });
        expect(history).toHaveFocus();
        pressEnter(history);

        expect(screen.getByRole('heading', { name: 'History' })).toHaveFocus();
        expect(history).toHaveAttribute('aria-current', 'page');
    });

    it('opens and closes the command palette and restores nav focus', async () => {
        render(<DesktopKeyboardShell />);
        const home = screen.getByRole('button', { name: 'Home' });
        home.focus();

        fireEvent.keyDown(home, { key: 'k', ctrlKey: true });
        await flushFocus();
        const search = screen.getByRole('combobox', { name: 'Search commands' });
        expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeTruthy();
        expect(search).toHaveFocus();

        fireEvent.keyDown(search, { key: 'Escape' });
        await flushFocus();
        expect(screen.queryByRole('dialog', { name: 'Wallet menu' })).toBeNull();
        expect(home).toHaveFocus();
    });

    it('restores focus after help closes and does not stack the palette over it', async () => {
        render(<DesktopKeyboardShell />);
        const history = screen.getByRole('button', { name: 'History' });
        history.focus();

        fireEvent.keyDown(history, { key: '?' });
        await flushFocus();
        const close = screen.getByRole('button', { name: 'Close' });
        expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeTruthy();
        expect(close).toHaveFocus();

        fireEvent.keyDown(close, { key: 'k', ctrlKey: true });
        expect(screen.queryByRole('dialog', { name: 'Wallet menu' })).toBeNull();
        fireEvent.keyDown(close, { key: 'Escape' });
        await flushFocus();
        expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeNull();
        expect(history).toHaveFocus();
    });

    it('disables the desktop palette shortcut while shortcut help is open', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'packages/desktop/renderer/App.jsx'),
            'utf8',
        );
        expect(source).toMatch(
            /useCommandPalette\(\{\s*enabled: status\.state === 'unlocked' && !shortcutHelpOpen,/,
        );
    });
});
