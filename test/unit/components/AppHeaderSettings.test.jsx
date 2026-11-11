// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import styles from '../../../packages/core/src/shared/components/AppHeader.module.css';
import { HeaderActionMenu } from '../../../packages/core/src/shared/components/HeaderActionMenu.jsx';

const appHeaderCss = readFileSync(
    'packages/core/src/shared/components/AppHeader.module.css',
    'utf8',
);

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('AppHeader', () => {
    it('renders the logo, plain wallet name, and controlled wallet menu trigger', () => {
        const onMenuToggle = vi.fn();
        const { container } = render(
            <AppHeader
                activeWallet={{ id: 'wallet-1', name: 'Everyday wallet' }}
                onMenuToggle={onMenuToggle}
                menuOpen
            />,
        );

        const header = screen.getByRole('region', { name: 'App header' });
        expect(within(header).getByAltText('XChain Wallet')).toBeTruthy();
        expect(within(header).getByText('Everyday wallet')).toHaveAttribute('title', 'Everyday wallet');
        expect(container.querySelector('[data-testid="wallet-identity"]')).toBeNull();

        const menu = within(header).getByRole('button', { name: 'Open menu' });
        expect(menu).toHaveAttribute('aria-haspopup', 'dialog');
        expect(menu).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(menu);
        expect(onMenuToggle).toHaveBeenCalledOnce();
    });

    it('keeps the menu trigger when no toggle handler is supplied', () => {
        render(<AppHeader />);
        expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders a disabled Lock control while locking', () => {
        const onLock = vi.fn();
        render(<AppHeader onLock={onLock} locking />);

        const lock = screen.getByRole('button', { name: 'Lock wallet' });
        expect(lock).toBeDisabled();
        fireEvent.click(lock);
        expect(onLock).not.toHaveBeenCalled();
    });

    it('shows the watch-only status independently of the wallet label', () => {
        render(<AppHeader isWatcherMode activeWallet={{ id: 'watch-1', name: 'Cold watch' }} />);
        expect(screen.getByRole('status', { name: 'Watch-only wallet' })).toBeTruthy();
        expect(screen.getByText('Cold watch')).toBeTruthy();
    });

    it('renders Open in new window as a header button on browser surfaces', () => {
        const onPopOut = vi.fn();
        render(<AppHeader onPopOut={onPopOut} />);

        fireEvent.click(screen.getByRole('button', { name: 'Open in new window' }));
        expect(onPopOut).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('reveals Open in new window only when the app bar reaches 640px', () => {
        render(<AppHeader onPopOut={() => {}} />);

        expect(screen.getByRole('button', { name: 'Open in new window' })).toHaveClass(styles.popOut);
        expect(appHeaderCss).toMatch(/\.bar\s*\{[^}]*container:\s*app-header\s*\/\s*inline-size;/s);
        expect(appHeaderCss).toMatch(/\.popOut\s*\{[^}]*display:\s*none;/s);
        expect(appHeaderCss).toMatch(/@container app-header \(min-width: 640px\)\s*\{\s*\.popOut\s*\{[^}]*display:\s*inline-flex;/s);
    });

    it('suppresses Open in new window in native and desktop shells', () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
        const native = render(<AppHeader onPopOut={() => {}} />);
        expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
        native.unmount();

        vi.unstubAllGlobals();
        vi.stubGlobal('xchainWalletWindow', {});
        render(<AppHeader onPopOut={() => {}} />);
        expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
    });

    it('has no unread indicator on any header control', () => {
        const { container } = render(
            <AppHeader onLock={() => {}} onMenuToggle={() => {}} activeWallet={{ id: 'w', name: 'Wallet' }} />,
        );
        expect(container.querySelector('[data-unread], [data-unread-count], [data-badge-count]')).toBeNull();
    });
});

describe('HeaderActionMenu', () => {
    it('is one Button that delegates state to its owner', () => {
        const onMenuToggle = vi.fn();
        const { container, rerender } = render(
            <HeaderActionMenu onMenuToggle={onMenuToggle} menuOpen={false} />,
        );

        expect(container.querySelectorAll('button')).toHaveLength(1);
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveAttribute('data-header-control');
        fireEvent.click(trigger);
        expect(onMenuToggle).toHaveBeenCalledOnce();

        rerender(<HeaderActionMenu onMenuToggle={onMenuToggle} menuOpen />);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('uses the filled primary Button style while the wallet menu is open', () => {
        const { rerender } = render(<HeaderActionMenu menuOpen={false} />);
        const trigger = screen.getByRole('button', { name: 'Open menu' });

        expect(trigger.className).toMatch(/secondary/);
        expect(trigger.className).not.toMatch(/primary/);

        rerender(<HeaderActionMenu menuOpen />);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(trigger.className).toMatch(/primary/);
        expect(trigger.className).not.toMatch(/secondary/);
    });
});
