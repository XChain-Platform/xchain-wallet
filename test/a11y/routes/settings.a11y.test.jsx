// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const SETTINGS = createDefaultSettings();
const sectionModules = import.meta.glob(
    '../../../packages/core/src/shared/components/settings/*Section.jsx',
);
const DRILLDOWN_SECTIONS = [
    { id: 'this-wallet', title: 'This wallet', component: 'ThisWalletSection' },
    { id: 'display', title: 'Display', component: 'DisplaySection' },
    { id: 'keyboard', title: 'Keyboard', component: 'KeyboardSection' },
    { id: 'privacy', title: 'Privacy', component: 'PrivacySection' },
    { id: 'safety', title: 'Safety', component: 'SafetySection' },
    { id: 'wallet-mode', title: 'Wallet mode', component: 'WalletModeSection' },
    { id: 'backup', title: 'Backup', component: 'BackupSection' },
    { id: 'fees', title: 'Fees', component: 'FeesSection' },
    { id: 'network-endpoints', title: 'Network & endpoints', component: 'NetworkEndpointsSection' },
    { id: 'connected-sites', title: 'Connected sites', component: 'ConnectedSitesSection' },
    { id: 'ads', title: 'Automatic donation system', component: 'AdsSection' },
    { id: 'developer', title: 'Developer mode', component: 'DeveloperModeSection' },
    { id: 'about', title: 'About', component: 'AboutSection' },
];
const INLINE_SECTIONS = [
    { query: 'theme reduced motion', title: 'Appearance', component: 'AppearanceSection' },
    { query: 'fiat locale custom iso', title: 'Language & region', component: 'LanguageRegionSection' },
    { query: 'active mainnet testnet', title: 'Network', component: 'NetworkSection' },
    { query: 'desktop permission quiet hours', title: 'Notifications', component: 'NotificationsSection' },
    { query: 'contacts address book export import', title: 'Contacts', component: 'ContactsSection' },
];

function pending() {
    return new Promise(() => {});
}

function settingsMessaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function renderSettings(props = {}) {
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging: settingsMessaging() }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                {...props}
            />
        </MessagingContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Settings route accessibility', () => {
    it('accounts for every settings section component', () => {
        const renderedComponents = [...DRILLDOWN_SECTIONS, ...INLINE_SECTIONS]
            .map(({ component }) => component)
            .sort();
        const sectionComponents = Object.keys(sectionModules)
            .map((path) => path.slice(path.lastIndexOf('/') + 1, -4))
            .sort();

        expect(renderedComponents).toEqual(sectionComponents);
    });

    it.each(DRILLDOWN_SECTIONS)('scans $component', async ({ id, title }) => {
        const { container } = renderSettings({ initialSubpageId: id });
        await screen.findByRole('heading', { name: title });
        await expectNoSeriousAxeViolations(container);
    });

    it.each(INLINE_SECTIONS)('scans $component', async ({ query, title }) => {
        const { container } = renderSettings();
        await screen.findByText('Primary Wallet');
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), {
            target: { value: query },
        });
        await screen.findByRole('heading', { name: title });
        await expectNoSeriousAxeViolations(container);
    });
});
