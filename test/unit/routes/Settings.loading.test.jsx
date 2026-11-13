// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings must render while the async settings read is still pending
// (settings === null). Regression: the Network section dereferenced
// settings.developerMode unguarded, crashing every mount that rendered
// before getSettings resolved; the palette's Settings deep-link
// was the first flow to drive it.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';

// 'this-wallet' is no longer a Settings sub-page: its rows live on Wallet Details and Security.
const SETTINGS_SUBPAGE_IDS = [
    'display',
    'keyboard',
    'privacy',
    'safety',
    'backup',
    'fees',
    'network-endpoints',
    'connected-sites',
    'ads',
    'developer',
    'about',
];

describe('Settings while settings are loading', () => {
    it('renders the section list with a never-resolving getSettings', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings onBack={() => {}} />
            </MessagingProvider>,
        );
        // The landing lists the group rows (Account, Preferences and More groups).
        expect(screen.getByText('Backup and Recovery')).toBeTruthy();
        expect(screen.getByText('Advanced')).toBeTruthy();
        expect(screen.getByText('Network and Fees')).toBeTruthy();
        expect(document.body.textContent).not.toContain('raw PSBT inspector');
        expect(screen.getByRole('searchbox').closest('[data-settings-layout="responsive"]')).toBeTruthy();
    });

    it('opens the wallet and account pickers from the Wallets group', () => {
        const onOpenWalletPicker = vi.fn();
        const onOpenAccountPicker = vi.fn();
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings
                    onBack={() => {}}
                    activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
                    activeAccount={{ id: 'account-2', index: 1, name: 'Savings' }}
                    onOpenWalletPicker={onOpenWalletPicker}
                    onOpenAccountPicker={onOpenAccountPicker}
                />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: /^Wallets/ }));
        expect(screen.getByText('Savings')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^My Wallets/ }));
        expect(onOpenWalletPicker).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: /^My Accounts/ }));
        expect(onOpenAccountPicker).toHaveBeenCalledOnce();
    });

    it('drops This Wallet confirmation state when the active wallet changes', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
            removeWallet: vi.fn(),
        };
        // Settings no longer lists This wallet as a page; the section is mounted directly
        // (Remove Wallet page) as it is from Wallet Details.
        const tree = (wallet) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <ThisWalletSection key={wallet.id} activeWallet={wallet} onWalletRemoved={() => {}} />
            </MessagingProvider>
        );
        const view = render(tree({ id: 'wallet-a', name: 'Alpha' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        expect(screen.getByLabelText('Confirm wallet name')).toBeTruthy();

        view.rerender(tree({ id: 'wallet-b', name: 'Beta' }));

        expect(screen.queryByLabelText('Confirm wallet name')).toBeNull();
        expect(screen.getByText('Beta')).toBeTruthy();
    });

    it('does not open This wallet as a Settings sub-page of its own', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings onBack={() => {}} initialSubpageId="this-wallet" />
            </MessagingProvider>,
        );
        expect(container.querySelector('[data-settings-page-template="subpage"]')).toBeNull();
    });

    it('does not open Wallet Mode as a Settings sub-page: it belongs to each wallet', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings onBack={() => {}} initialSubpageId="wallet-mode" />
            </MessagingProvider>,
        );
        expect(container.querySelector('[data-settings-page-template="subpage"]')).toBeNull();
    });

    it.each(SETTINGS_SUBPAGE_IDS)('renders the %s sub-page through the shared Settings template', (subpageId) => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: () => Promise.resolve([]),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings onBack={() => {}} initialSubpageId={subpageId} />
            </MessagingProvider>,
        );

        expect(container.querySelector('[data-settings-page-template="subpage"]')).toBeTruthy();
    });
});
