// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings group pages are labelled lists of rows (G08). Since the
// 2026-11-13 redesign a setting that is one switch, one short choice or one
// action changes on its row; only a setting with several related fields
// opens a page. Settings buttons are never the grey ghost style (operator
// 2026-11-13), and sizes read in KB or MB, never raw bytes.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { WALLET_VERSION } from '../../../packages/core/src/buildInfo.js';
import { formatByteSize } from '../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx';

afterEach(() => cleanup());

const ROOT = join(__dirname, '../../..');
const SETTINGS_DIR = join(ROOT, 'packages/core/src/shared/components/settings');

function messaging(initial = createDefaultSettings()) {
    let stored = structuredClone(initial);
    return {
        getSettings: vi.fn(async () => structuredClone(stored)),
        updateSettings: vi.fn(async (patch) => {
            stored = { ...stored, ...patch };
            return structuredClone(stored);
        }),
        listConnectedSites: () => Promise.resolve([]),
        listContacts: () => Promise.resolve([]),
    };
}

function renderSettings(props = {}, msg = messaging()) {
    return render(
        <MessagingProvider shell="web" messaging={msg}>
            <Settings onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

/** The labelled row lists on the open group page, as { label: [row titles] }. */
function rowLists(container) {
    const lists = [...container.querySelectorAll('ul[role="list"][aria-label]')];
    return Object.fromEntries(lists.map((list) => [
        list.getAttribute('aria-label'),
        [...list.querySelectorAll(':scope > li')].map((li) => (
            li.querySelector('[data-settings-row-title]')
            || li.querySelector('button > span:nth-of-type(2) > span:first-child')
        )?.textContent),
    ]));
}

/** The ids of the rows that open a page (a drill-in button), in order. */
function drillRows(container) {
    return [...container.querySelectorAll('[data-settings-row-id] > button')]
        .map((button) => button.closest('li').getAttribute('data-settings-row-id'));
}

describe('Settings group pages are lists of rows (G08)', () => {
    it('lays Appearance out as drawn, with the choice rows opening pages (2026-11-14)', async () => {
        const { container } = renderSettings({ initialSubpageId: 'g-appearance' });
        await screen.findByRole('switch', { name: 'Haptic feedback' });
        expect(rowLists(container)).toEqual({
            Look: ['Theme', 'Reduce motion', 'Haptic feedback', 'Learn mode'],
            'Language and region': ['Language', 'Fiat currency'],
            Balances: ['Hide small balances', 'Hide unknown tokens', 'Number format'],
            'Tokens and lists': ['Pin button on rows', 'Hide button on rows', 'Tokens', 'Clear remembered network filters', 'Reset display settings'],
        });
        expect(drillRows(container)).toEqual([
            'appearance-theme', 'appearance-language', 'appearance-currency',
            'display-balances', 'display-number-format',
            'display-tokens', 'display-lists', 'display-reset',
        ]);
        await waitFor(() => expect(screen.getByRole('button', { name: /^Theme/ }).textContent).toContain('System default'));
        expect(screen.getByRole('combobox', { name: 'Reduce motion' }).textContent).toContain('System');
        expect(container.querySelector('select')).toBeNull();
    });

    it('opens Tokens with the watched, pinned and hidden lists, and Back returns to Appearance', async () => {
        renderSettings({ initialSubpageId: 'g-appearance' });
        fireEvent.click(await screen.findByRole('button', { name: /^Tokens/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Tokens' })).toBeTruthy();
        // Framed icon tabs, no counts; the page draws its own header.
        const watchedTab = await screen.findByText('Watched');
        const tabs = watchedTab.closest('[aria-label="Token lists"]');
        expect(tabs.textContent.replace('★', '')).toBe('WatchedPinnedHidden');
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Appearance' })).toBeTruthy();
    });

    it('opens Add Watched Token from the Tokens plus, and Back returns to Tokens', async () => {
        renderSettings({ initialSubpageId: 'display-tokens' });
        fireEvent.click(await screen.findByRole('button', { name: 'Add watched token' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Add Watched Token' })).toBeTruthy();
        expect(await screen.findByRole('searchbox', { name: 'Search tokens to watch' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Tokens' })).toBeTruthy();
    });

    it('lays Network and Fees out as one card', async () => {
        const { container } = renderSettings({ initialSubpageId: 'g-network' });
        await waitFor(() => expect(container.querySelector('[data-settings-row-id="network-active"]')).toBeTruthy());
        // Donations folded into Network and Fees; no one-row headings.
        expect(rowLists(container)).toEqual({
            'Network and Fees': ['Network', 'Fee strategy', 'Automatic Donations'],
        });
        // Network is a chevron row (2026-11-14), no dropdown: it opens its own page.
        expect(drillRows(container)).toEqual(['network-active', 'fees', 'ads']);
        expect(screen.queryByRole('combobox', { name: 'Active network' })).toBeNull();
        expect(container.querySelector('[data-settings-row-id="network-active"]').textContent).toContain('Mainnet');
    });

    it('lays Advanced out under one Developer heading and opens each developer tool directly', async () => {
        const onNavigateToAdvanced = vi.fn();
        const onNavigateToActionQueue = vi.fn();
        const { container } = renderSettings({
            initialSubpageId: 'g-advanced',
            onNavigateToAdvanced,
            onNavigateToActionQueue,
        });
        await screen.findByRole('switch', { name: 'Developer mode' });
        const lists = rowLists(container);
        expect(lists.Developer).toEqual(['Developer mode', 'Developer options', 'Advanced action', 'Action queue']);
        // About moved to the top of Settings (2026-11-14).
        expect(lists.App).toEqual(['Keyboard shortcuts']);
        expect(lists.App).not.toContain('About');
        fireEvent.click(screen.getByRole('button', { name: /^Advanced action/ }));
        expect(onNavigateToAdvanced).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: /^Action queue/ }));
        expect(onNavigateToActionQueue).toHaveBeenCalledOnce();
        // Without a shell route the two-phone row is not offered.
        expect(lists.Signing).toBeUndefined();
    });

    it('lists "Use another phone as a signer" under Signing and opens the pairing page (2026-11-15)', async () => {
        const onPairAnotherPhone = vi.fn();
        const { container } = renderSettings({ initialSubpageId: 'g-advanced', onPairAnotherPhone });
        await screen.findByRole('switch', { name: 'Developer mode' });
        const lists = rowLists(container);
        expect(lists.Signing).toEqual(['Use another phone as a signer']);
        // It is a user setting, so it sits above the Developer heading.
        expect(Object.keys(lists).indexOf('Signing')).toBeLessThan(Object.keys(lists).indexOf('Developer'));
        fireEvent.click(screen.getByRole('button', { name: /^Use another phone as a signer/ }));
        expect(onPairAnotherPhone).toHaveBeenCalledOnce();
    });

    it('dims Developer options while Developer mode is off, with no badge and no chevron', async () => {
        renderSettings({ initialSubpageId: 'g-advanced', onNavigateToActionQueue: () => {} });
        await screen.findByRole('switch', { name: 'Developer mode' });
        const options = screen.getByRole('button', { name: /^Developer options/ });
        expect(options.disabled).toBe(true);
        expect(options.textContent).not.toContain('Developer mode on');
        expect(screen.queryByText('Developer mode on')).toBeNull();
        // The chevron is the row's trailing aria-hidden span.
        expect(options.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
        fireEvent.click(options);
        expect(screen.queryByRole('heading', { level: 1, name: 'Developer Options' })).toBeNull();
        // Another drill-in row keeps its chevron, so the check above can fail.
        const queue = screen.getByRole('button', { name: /^Action queue/ });
        expect(queue.querySelector(':scope > span[aria-hidden="true"]')).not.toBeNull();
    });

    it('keeps Developer mode off after opening Advanced action and pressing Back', async () => {
        const msg = messaging();
        const onNavigateToAdvanced = vi.fn();
        const first = renderSettings({ initialSubpageId: 'g-advanced', onNavigateToAdvanced }, msg);
        const toggle = await screen.findByRole('switch', { name: 'Developer mode' });
        fireEvent.click(toggle);
        await waitFor(() => expect(msg.updateSettings).toHaveBeenCalledWith({ developerMode: true }));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Developer mode' }).getAttribute('aria-checked')).toBe('true'));
        fireEvent.click(screen.getByRole('switch', { name: 'Developer mode' }));
        await waitFor(() => expect(msg.updateSettings).toHaveBeenLastCalledWith({ developerMode: false }));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Developer mode' }).getAttribute('aria-checked')).toBe('false'));
        // Advanced action is a page outside Settings, so Settings unmounts;
        // Back mounts it again from the saved record.
        fireEvent.click(screen.getByRole('button', { name: /^Advanced action/ }));
        expect(onNavigateToAdvanced).toHaveBeenCalledOnce();
        first.unmount();
        renderSettings({ initialSubpageId: 'g-advanced', onNavigateToAdvanced }, msg);
        const again = await screen.findByRole('switch', { name: 'Developer mode' });
        await waitFor(() => expect(again.getAttribute('aria-checked')).toBe('false'));
        expect(screen.getByRole('button', { name: /^Developer options/ }).disabled).toBe(true);
    });

    it('puts About first on Settings with the logo and the version, opening the About page', async () => {
        const { container } = renderSettings();
        const row = await screen.findByRole('button', { name: /^About/ });
        const lists = rowLists(container);
        expect(Object.keys(lists)[0]).toBe('About');
        expect(lists.About).toEqual(['About']);
        expect(row.querySelector('img[data-testid="settings-about-logo"]')).toBeTruthy();
        expect(row.textContent).toContain(WALLET_VERSION);
        fireEvent.click(row);
        expect(await screen.findByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
        expect(screen.getByText('Version')).toBeTruthy();
    });

    it('opens Developer options once Developer mode is on, with its switches and choice inline', async () => {
        const msg = messaging();
        const { container } = renderSettings({ initialSubpageId: 'g-advanced' }, msg);
        fireEvent.click(await screen.findByRole('switch', { name: 'Developer mode' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Developer options/ }).disabled).toBe(false));
        expect(msg.updateSettings).toHaveBeenCalledWith({ developerMode: true });
        fireEvent.click(screen.getByRole('button', { name: /^Developer options/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Developer Options' })).toBeTruthy();
        expect(rowLists(container)['Developer options']).toEqual([
            'Show variant popover',
            'Test networks',
            'Regtest faucet',
            'Auto-approve localhost dApps',
            'Localhost auto-sign',
            'Logs and diagnostics console',
        ]);
        expect(screen.getByRole('switch', { name: 'Show variant popover' })).toBeTruthy();
        const autoSign = screen.getByRole('combobox', { name: 'Localhost auto-sign' });
        expect(autoSign).toBeTruthy();
        // The themed dropdown lists Off, 5 minutes, 10 minutes and 1 hour, an icon each.
        fireEvent.click(autoSign);
        const labels = screen.getAllByRole('option').map((o) => o.textContent.trim());
        expect(labels).toEqual(['Off', '5 minutes', '10 minutes', '1 hour']);
        fireEvent.keyDown(autoSign, { key: 'Escape' });
        // Test Networks opens Add Network, which opens Add Custom Network;
        // each Back returns one level.
        fireEvent.click(screen.getByRole('button', { name: /^Test networks/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Test Networks' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Add Network/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Add Network' })).toBeTruthy();
        // Add Custom Network is the plus in Add Network's title bar (2026-11-15).
        expect(screen.queryByRole('button', { name: /^Custom network/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Add Custom Network' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Add Custom Network' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Add Network' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Test Networks' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Developer Options' })).toBeTruthy();
    });

    it('resolves the retired Regtest networks and Custom networks pages to Test Networks', async () => {
        const msg = messaging();
        renderSettings({ initialSubpageId: 'developer-custom-chains' }, msg);
        expect(await screen.findByRole('heading', { level: 1, name: 'Test Networks' })).toBeTruthy();
    });

    it('opens a network page from its id and the faucet with its own header', async () => {
        const msg = messaging();
        renderSettings({ initialSubpageId: 'developer-test-network:bitcoin-regtest' }, msg);
        expect(await screen.findByRole('heading', { level: 1, name: 'Bitcoin Regtest' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Actions/ })).toBeTruthy();
        cleanup();
        renderSettings({ initialSubpageId: 'developer-faucet' }, messaging());
        expect(await screen.findByRole('heading', { level: 1, name: 'Regtest Faucet' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Get Test Coins/ })).toBeTruthy();
    });

    it.each([
        ['display-tokens-add', 'Add Watched Token'],
        ['backup-phrase', 'Recovery Phrase'],
        ['security-password', 'Wallet Password'],
        ['security-duress', 'Duress Passphrase'],
        ['notifications-quiet', 'Quiet Hours'],
        ['notifications-sounds', 'Notification Sounds'],
    ])('opens the %s row page through the Settings template without repeating its title', async (id, title) => {
        const { container } = renderSettings({ initialSubpageId: id });
        expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
        expect(container.querySelector('[data-settings-page-template="subpage"]')).toBeTruthy();
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        // U18: no section heading repeats the page title.
        const repeats = [...container.querySelectorAll('h2, h3')]
            .filter((h) => h.textContent.trim().toLowerCase() === title.toLowerCase());
        expect(repeats).toEqual([]);
    });

    it('opens the Price Alerts page, which draws its own header, from its row id', async () => {
        const { container } = renderSettings({
            initialSubpageId: 'notifications-price-alerts',
            activeWallet: { id: 'wallet-1', name: 'Test wallet' },
        }, {
            ...messaging(),
            listPriceAlertsForWallet: vi.fn(async () => []),
            savePriceAlert: vi.fn(),
            clearPriceAlert: vi.fn(),
        });
        expect(await screen.findByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
        // The page owns its screen (filter and plus in the header), so Settings draws no template around it.
        expect(container.querySelector('[data-settings-page-template="subpage"]')).toBeNull();
        expect(await screen.findByRole('button', { name: 'Add Price Alert' })).toBeTruthy();
    });

    it('puts the update check on About rather than Advanced', async () => {
        renderSettings({ initialSubpageId: 'g-about' });
        expect(await screen.findByRole('button', { name: /^Check for Updates/ })).toBeTruthy();
    });

    it('lands Encrypted backup file straight on its password step', async () => {
        renderSettings({ initialSubpageId: 'g-backup', activeWallet: { id: 'w1', name: 'Main' } });
        fireEvent.click(await screen.findByRole('button', { name: /^Encrypted backup file/ }));
        expect(await screen.findByLabelText('Backup password')).toBeTruthy();
    });
});

describe('Settings buttons and sizes', () => {
    it('draws no Settings button in the grey ghost style', () => {
        const files = [
            join(ROOT, 'packages/core/src/shared/routes/Settings.jsx'),
            join(ROOT, 'packages/core/src/shared/routes/SettingsInlineRows.jsx'),
            ...readdirSync(SETTINGS_DIR).filter((name) => name.endsWith('.jsx')).map((name) => join(SETTINGS_DIR, name)),
        ];
        const offenders = files.filter((file) => /variant=["']ghost["']/.test(readFileSync(file, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('formats sizes in KB or MB, never raw bytes', () => {
        // The shared formatter (utils/formatBytes.js): nothing reads 0 KB, a
        // non-empty size never reads as 0 KB, and whole units drop the ".0".
        expect(formatByteSize(0)).toBe('0 KB');
        expect(formatByteSize(1)).toBe('0.1 KB');
        expect(formatByteSize(12_800)).toBe('12.5 KB');
        expect(formatByteSize(3 * 1024 * 1024)).toBe('3 MB');
    });
});
