// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const SETTINGS = createDefaultSettings();
const sectionModules = import.meta.glob(
    '../../../packages/core/src/shared/components/settings/*Section.jsx',
);
const DRILLDOWN_SECTIONS = [
    // Settings does not list This wallet on its own; its removal part is the
    // page Wallet Details opens.
    { id: 'wallet-remove', title: 'Remove Wallet', component: 'ThisWalletSection' },
    { id: 'display', title: 'Display', component: 'DisplaySection' },
    { id: 'keyboard', title: 'Keyboard', component: 'KeyboardSection' },
    { id: 'privacy', title: 'Privacy', component: 'PrivacySection' },
    { id: 'safety', title: 'Safety', component: 'SafetySection' },
    { id: 'backup', title: 'Backup', component: 'BackupSection' },
    { id: 'fees', title: 'Fees', component: 'FeesSection' },
    { id: 'network-endpoints', title: 'Network & Endpoints', component: 'NetworkEndpointsSection' },
    { id: 'connected-sites', title: 'Connected Sites', component: 'ConnectedSitesSection' },
    { id: 'ads', title: 'Automatic Donation System', component: 'AdsSection' },
    { id: 'developer', title: 'Developer Mode', component: 'DeveloperModeSection' },
    { id: 'about', title: 'About', component: 'AboutSection' },
];
// These sections are parts of a grouped page (or a row page) rather than a
// page of their own, so each opens through the page that holds it.
const GROUPED_SECTIONS = [
    { id: 'g-appearance', title: 'Appearance', component: 'AppearanceSection' },
    { id: 'g-appearance', title: 'Appearance', component: 'LanguageRegionSection' },
    { id: 'g-network', title: 'Network and Fees', component: 'NetworkSection' },
    { id: 'g-notifications', title: 'Notifications', component: 'NotificationsSection' },
    { id: 'backup-contacts', title: 'Export or Import Contacts', component: 'ContactsSection' },
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
        const renderedComponents = [...DRILLDOWN_SECTIONS, ...GROUPED_SECTIONS]
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

    it.each(GROUPED_SECTIONS)('scans $component', async ({ id, title }) => {
        const { container } = renderSettings({ initialSubpageId: id });
        // A grouped page repeats its own title as the heading of its first part.
        await screen.findAllByRole('heading', { name: title });
        await expectNoSeriousAxeViolations(container);
    });
});
