// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The account/wallet switcher is promoted into the persistent
// AppHeader. Before this, HeaderSettingsButton was defined but never
// rendered anywhere, so switching account meant a walk through
// Settings -> Accounts (advanced). These guards pin both halves: the
// header mounts the gear when a host wires a switch surface, and the
// gear itself degrades cleanly when only some sections are wired.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';

afterEach(() => cleanup());

const chainRegistry = registryLib.defaultRegistry();
const COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];

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
        expect(screen.getByText('Network')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { expanded: false, name: /All networks/ }));
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));
        expect(onNetworkFilterChange).toHaveBeenCalledWith('litecoin');
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
