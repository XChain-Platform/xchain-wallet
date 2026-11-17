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
    // Settings does not list This wallet on its own; its removal part is the
    // page Wallet Details opens.
    { id: 'wallet-remove', title: 'Remove Wallet', component: 'ThisWalletSection' },
    // Display's lists are the Tokens page, which draws its own header, and
    // its plus opens Add Watched Token (2026-11-14).
    { id: 'display-tokens', title: 'Tokens', component: 'TokenListsSection' },
    { id: 'display-tokens-add', title: 'Add Watched Token', component: 'AddWatchedTokenSection' },
    { id: 'keyboard', title: 'Keyboard', component: 'KeyboardSection' },
    // Privacy and Sites changes PrivacySection's settings on its rows
    // (2026-11-13); the old Privacy page id opens it.
    { id: 'privacy', title: 'Privacy and Sites', component: 'PrivacySection' },
    // Security changes SafetySection's settings on its rows; the old Safety id opens it.
    { id: 'safety', title: 'Security', component: 'SafetySection' },
    { id: 'backup', title: 'Backup', component: 'BackupSection' },
    { id: 'fees', title: 'Fees', component: 'FeesSection' },
    { id: 'network-endpoints', title: 'Network & Endpoints', component: 'NetworkEndpointsSection' },
    { id: 'connected-sites', title: 'Connected Sites', component: 'ConnectedSitesSection' },
    { id: 'ads', title: 'Automatic Donations', component: 'AdsSection' },
    // The old Developer page opens Advanced > Developer options (2026-11-13).
    { id: 'developer', title: 'Developer Options', component: 'DeveloperModeSection' },
    { id: 'about', title: 'About', component: 'AboutSection' },
];
// These sections are parts of a grouped page (or a row page) rather than a
// page of their own, so each opens through the page that holds it.
const GROUPED_SECTIONS = [
    // Since 2026-11-13 these sections' settings change on their group page
    // rows; each old row id opens that group page.
    // Theme, Language and Hide small balances open pages of their own built
    // on these sections' options (operator rulings 2026-11-14).
    { id: 'appearance-theme', title: 'Theme', component: 'AppearanceSection' },
    { id: 'display-balances', title: 'Hide Small Balances', component: 'DisplaySection' },
    { id: 'appearance-language', title: 'Language', component: 'LanguageRegionSection' },
    // The Network row opens its own page of environment rows (2026-11-14);
    // NetworkSection stays the shell's panel for the same setting.
    { id: 'network-active', title: 'Network', component: 'NetworkSection' },
    // The Price Alerts page is its own section (list, alert, add and edit pages);
    // Quiet Hours is a part of the notifications panel.
    { id: 'notifications-price-alerts', title: 'Price Alerts', component: 'PriceAlertsSection' },
    { id: 'notifications-quiet', title: 'Quiet Hours', component: 'NotificationsSection' },
    { id: 'backup-contacts', title: 'Backup and Recovery', component: 'ContactsSection' },
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

    // The row lists and the one-setting pages their rows open (G08).
    it.each([
        ['g-appearance', 'Appearance'],
        ['g-network', 'Network and Fees'],
        ['g-advanced', 'Advanced'],
        // Inline switch, dropdown and button rows (2026-11-13).
        ['g-privacy', 'Privacy and Sites'],
        ['g-security', 'Security'],
        ['g-backup', 'Backup and Recovery'],
        ['g-notifications', 'Notifications'],
        ['advanced-developer-options', 'Developer Options'],
        ['notifications-quiet', 'Quiet Hours'],
        ['notifications-sounds', 'Notification Sounds'],
        ['notifications-sound:incomingPending', 'Choose Sound'],
        ['notifications-add-sound:incomingPending', 'Add Sound'],
        // The Test Networks pages (operator picks 2026-11-14).
        ['developer-test-networks', 'Test Networks'],
        ['developer-add-network', 'Add Network'],
        ['developer-add-custom-network', 'Add Custom Network'],
        ['developer-test-network:bitcoin-regtest', 'Bitcoin Regtest'],
        ['developer-faucet', 'Regtest Faucet'],
        // Action pages that land straight on their form, plus the log console.
        ['backup-phrase', 'Recovery Phrase'],
        ['backup-test', 'Test Backup'],
        ['backup-publish', 'Publish Labels On-Chain'],
        ['backup-restore', 'Restore Contacts'],
        ['backup-contacts-export', 'Export Contacts'],
        ['security-password', 'Wallet Password'],
        // Security pages (operator rulings 2026-11-14).
        ['security-panic', 'Panic Mode'],
        ['security-biometric-enable', 'Enable Biometric Unlock'],
        ['developer-logs', 'Logs and Diagnostics Console'],
    ])('scans the %s row page', async (id, title) => {
        const { container } = renderSettings({ initialSubpageId: id });
        await screen.findByRole('heading', { level: 1, name: title });
        await expectNoSeriousAxeViolations(container);
    });

    // The Appearance pages (operator rulings 2026-11-14), scanned once their
    // content has loaded: the check-marked current rows, the symbol marks,
    // the header filter button, the live sample over the Display format
    // field, the Display Format picker page and the one action button.
    it.each([
        ['appearance-theme', 'Theme', () => screen.findByRole('list', { name: 'Themes' })],
        ['appearance-language', 'Language', () => screen.findByRole('list', { name: 'Languages' })],
        ['appearance-currency', 'Fiat Currency', () => screen.findByRole('list', { name: 'Fiat currencies' })],
        ['display-number-format', 'Number Format', () => screen.findByRole('button', { name: 'Display format: Full decimals' })],
        ['display-number-format-picker', 'Display Format', () => screen.findByRole('list', { name: 'Display formats' })],
        ['display-lists', 'Clear Remembered Network Filters', () => screen.findByRole('button', { name: 'Clear Network Filters' })],
        ['display-reset', 'Reset Display Settings', () => screen.findByRole('button', { name: 'Reset Display Settings' })],
    ])('scans the %s page with its content', async (id, title, content) => {
        const { container } = renderSettings({ initialSubpageId: id });
        await screen.findByRole('heading', { level: 1, name: title });
        await content();
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the Add Sound full-page icon picker', async () => {
        const { container } = renderSettings({ initialSubpageId: 'notifications-add-sound:incomingPending' });
        fireEvent.click(await screen.findByRole('button', { name: 'Icon: Alarm Clock' }));
        await screen.findByRole('heading', { level: 1, name: 'Choose Icon' });
        await screen.findByRole('list', { name: 'Sound icons' });
        await expectNoSeriousAxeViolations(container);
    });
});

// Connected Sites with data: every view of the toggle and every drill-in.
describe('Connected Sites accessibility', () => {
    function renderSites() {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue(SETTINGS),
            updateSettings: vi.fn().mockResolvedValue(SETTINGS),
            listConnectedSites: vi.fn().mockResolvedValue([{
                id: 's1',
                origin: 'https://market.example',
                appName: 'Market',
                connectedAt: '2026-10-28T00:00:00.000Z',
                lastUsedAt: '2026-10-28T00:00:00.000Z',
                permissions: { chains: ['bitcoin'], accounts: ['a1'], canSignMessage: false, canSignAction: { SEND: 'always' } },
            }]),
            listBlockedOrigins: vi.fn().mockResolvedValue(['*.scam.example']),
            blockOrigin: vi.fn(),
            unblockOrigin: vi.fn(),
            deleteConnectedSite: vi.fn(),
        };
        return render(
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                <Settings
                    onBack={() => {}}
                    activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                    activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                    onOpenWalletPicker={() => {}}
                    onOpenAccountPicker={() => {}}
                    initialSubpageId="connected-sites"
                />
            </MessagingContext.Provider>,
        );
    }

    it('scans the Allowed, Blocked and Options views', async () => {
        const { container } = renderSites();
        await screen.findByRole('list', { name: 'Allowed sites' });
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('radio', { name: 'Blocked' }));
        await screen.findByRole('list', { name: 'Blocked sites' });
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('radio', { name: 'Options' }));
        await screen.findByRole('list', { name: 'Sign-request throttle controls' });
        await expectNoSeriousAxeViolations(container);
    });

    it('closes a site detail with Escape and stays on Connected Sites', async () => {
        renderSites();
        fireEvent.click((await screen.findByText('Market')).closest('button'));
        await screen.findByRole('list', { name: 'Permissions' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(await screen.findByRole('list', { name: 'Allowed sites' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 1, name: 'Connected Sites' })).toBeTruthy();
    });

    it('scans the site detail, the blocked entry detail and the Block Site form', async () => {
        const { container } = renderSites();
        fireEvent.click((await screen.findByText('Market')).closest('button'));
        await screen.findByRole('list', { name: 'Permissions' });
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        fireEvent.click(await screen.findByRole('radio', { name: 'Blocked' }));
        fireEvent.click((await screen.findByText('*.scam.example')).closest('button'));
        await screen.findByRole('region', { name: 'Blocked entry' });
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Block a site' }));
        await screen.findByRole('textbox', { name: 'Origin or wildcard to block' });
        await expectNoSeriousAxeViolations(container);
    });
});
