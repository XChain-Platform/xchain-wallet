// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: desktop navigation and Settings return paths.
//
//   [P1] 2026-10-13: Full and rail desktop navigation keep Marketplace
//        beside DEX and Dispensers. Every Settings sub-page exposes a
//        Back to settings control, including Accounts & addresses.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';
import { MessagingContext } from '../../packages/core/src/shared/MessagingContext.js';
import {
    FullLayoutWithNav,
    LeftNav,
} from '../../packages/core/src/shared/components/LeftNav.jsx';

let settings;
let updateSettings;

vi.mock('../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings,
        loading: false,
        error: null,
        update: updateSettings,
    }),
}));

const { AccountPicker } = await import('../../packages/core/src/shared/routes/AccountPicker.jsx');
const { Settings } = await import('../../packages/core/src/shared/routes/Settings.jsx');

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

const INTERNAL_SETTINGS_PAGES = [
    ['this-wallet', 'This wallet'],
    ['display', 'Display'],
    ['keyboard', 'Keyboard'],
    ['privacy', 'Privacy'],
    ['safety', 'Safety'],
    ['wallet-mode', 'Wallet mode'],
    ['backup', 'Backup'],
    ['fees', 'Fees'],
    ['network-endpoints', 'Network & endpoints'],
    ['connected-sites', 'Connected sites'],
    ['ads', 'Automatic donation system'],
    ['developer', 'Developer mode'],
    ['about', 'About'],
];

function pending() {
    return new Promise(() => {});
}

function buildMessaging() {
    const messaging = {
        listAccounts: vi.fn().mockResolvedValue([]),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(messaging, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function withDesktopMessaging(node, messaging = buildMessaging()) {
    return (
        <MessagingContext.Provider value={{ shell: 'desktop', messaging }}>
            {node}
        </MessagingContext.Provider>
    );
}

function renderSettingsPage(initialSubpageId) {
    return render(withDesktopMessaging(
        <Settings
            onBack={() => {}}
            activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
            activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
            onOpenWalletPicker={() => {}}
            onOpenAccountPicker={() => {}}
            initialSubpageId={initialSubpageId}
            reload={() => {}}
        />,
    ));
}

beforeEach(() => {
    settings = createDefaultSettings();
    updateSettings = vi.fn(async () => settings);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

describe('regression/desktop-nav-marketplace', () => {
    it.each([
        [768, 'rail'],
        [1440, 'full'],
    ])('[REGRESSION P1] lists Marketplace with trading destinations in the %s px %s navigation', (width, tier) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        const onSelect = vi.fn();
        const view = render(
            <FullLayoutWithNav
                nav={<LeftNav currentView="home" onSelect={onSelect} />}
                bottomBar={<div data-testid="bottom-bar" />}
            >
                <main>Route content</main>
            </FullLayoutWithNav>,
        );

        expect(view.container.firstChild).toHaveAttribute('data-xc-tier', tier);
        expect(screen.queryByTestId('bottom-bar')).toBeNull();
        const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
        const tradingDestinations = within(navigation).getAllByRole('button')
            .filter((button) => ['DEX', 'Marketplace', 'Dispensers'].includes(button.textContent.trim()))
            .map((button) => button.textContent.trim());
        expect(tradingDestinations).toEqual(['DEX', 'Marketplace', 'Dispensers']);

        fireEvent.click(within(navigation).getByRole('button', { name: 'Marketplace' }));
        expect(onSelect).toHaveBeenCalledWith('market-activity');
    });

    it.each(INTERNAL_SETTINGS_PAGES)(
        '[REGRESSION P1] returns from the %s Settings sub-page with Back to settings',
        (sectionId, title) => {
            // Network & endpoints is listed only in Developer Mode.
            if (sectionId === 'network-endpoints') settings = { ...settings, developerMode: true };
            renderSettingsPage(sectionId);

            expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
            expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
        },
    );

    it('[REGRESSION P1] returns from Accounts & addresses with Back to settings', () => {
        const onBack = vi.fn();
        render(withDesktopMessaging(
            <AccountPicker
                walletId="wallet-1"
                activeAccountId="account-1"
                onSwitch={() => {}}
                onAddAccount={() => {}}
                onBack={onBack}
                backLabel="Back to settings"
            />,
        ));

        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
