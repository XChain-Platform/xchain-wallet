// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings standing rules, second pass:
//   - An action lands on its final step: the Recovery phrase, Test backup,
//     Publish labels, Check network and Wallet password pages open straight
//     on their form, with no intro button and no Cancel; Back leaves. Every
//     gate stays (the password step, the blurred words, the publish confirm).
//   - Nothing expands in place on an info page: About documents open externally
//     and the Developer mode log console has its own page.
//   - Search finds every setting on the row-list group pages: a hit names the
//     group that lists the row and highlights that row by id.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    SEARCH_ROW_PAGES,
    SETTINGS_SEARCH_ROWS,
    Settings,
} from '../../../packages/core/src/shared/routes/Settings.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { LICENSE_URL } from '../../../packages/core/src/buildInfo.js';

vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({
    LogConsole: () => <div data-testid="log-console" />,
    LogConsoleControls: () => <div data-testid="log-console-controls" />,
    useLogConsole: () => ({ search: '', setSearch: () => {}, levelsNarrowed: false }),
}));

afterEach(() => {
    cleanup();
    delete window.xchainWalletUpdater;
});

const WALLET = { id: 'w1', name: 'Main' };

function messaging(overrides = {}) {
    const settings = { ...createDefaultSettings(), developerMode: true };
    return {
        getSettings: vi.fn(async () => settings),
        updateSettings: vi.fn(async (patch) => ({ ...settings, ...patch })),
        listConnectedSites: () => Promise.resolve([]),
        getAddressesByChain: vi.fn(async () => ({ 'bitcoin-mainnet': [{ address: 'bc1qexample' }] })),
        ...overrides,
    };
}

function renderSettings(props = {}, overrides = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging(overrides)}>
            <Settings onBack={() => {}} activeWallet={WALLET} {...props} />
        </MessagingProvider>,
    );
}

const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));

describe('Settings actions land on their final step', () => {
    it.each([
        ['g-backup', /^Recovery phrase/, () => screen.findByLabelText('Wallet password'), 'Reveal Phrase', /^Show…/],
        ['g-backup', /^Test backup/, () => screen.findByLabelText('Recovery phrase to test'), 'Run Test', /^Test…/],
        ['g-backup', /^Publish labels on-chain/, () => screen.findByLabelText('Wallet password'), 'Publish Labels', /^Publish Now/],
        ['g-backup', /^Restore contacts/, () => screen.findByLabelText('Wallet password'), 'Check for Contacts', /^Check…/],
        ['g-security', /^Wallet password/, () => screen.findByLabelText('Current wallet password'), 'Change Password', /^Change…/],
    ])('%s %s opens on its form with no intro button and no Cancel', async (group, row, field, submit, intro) => {
        renderSettings({ initialSubpageId: group });
        const groupHeading = (await screen.findByRole('heading', { level: 1 })).textContent;
        fireEvent.click(await screen.findByRole('button', { name: row }));

        expect(await field()).toBeTruthy();
        expect(screen.getByRole('button', { name: submit })).toBeTruthy();
        expect(screen.queryByRole('button', { name: intro })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        if (group === 'g-backup') {
            // A Backup and Recovery form page is a plain Form Standard page
            // (operator walk 2026-11-15): its notes are one notice at the top
            // of the form column, never a note card above it.
            expect(document.querySelector('[data-warning-line]')).toBeNull();
            expect(document.querySelector('form [data-tone], [role="group"] [data-tone]')).toBeTruthy();
        } else {
            // The page's notes sit in the notice card above the form.
            expect(document.querySelector('[data-warning-line]')).toBeTruthy();
        }

        back();
        expect(await screen.findByRole('heading', { level: 1, name: groupHeading })).toBeTruthy();
    });

    it.each([
        ['backup-phrase', /^Recovery Phrase$/i],
        ['backup-test', /^Test Backup$/i],
        ['backup-publish', /^Publish Labels On-Chain$/i],
        ['backup-restore', /^Restore Contacts$/i],
        ['security-password', /^Wallet Password$/i],
    ])('the %s page does not repeat its title in a section heading', async (id, title) => {
        const { container } = renderSettings({ initialSubpageId: id });
        const heading = await screen.findByRole('heading', { level: 1, name: title });
        await waitFor(() => expect(container.querySelector('input')).toBeTruthy());
        const repeats = [...container.querySelectorAll('h2, h3')]
            .filter((h) => h.textContent.trim().toLowerCase() === heading.textContent.trim().toLowerCase());
        expect(repeats).toEqual([]);
    });

    it('keeps the recovery phrase behind the password step and the reveal tap', async () => {
        const revealMnemonicRequest = vi.fn(async () => ({ mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident' }));
        render(
            <MessagingProvider shell="web" messaging={{ revealMnemonicRequest }}>
                <BackupSection activeWallet={WALLET} only="phrase" direct />
            </MessagingProvider>,
        );

        expect(screen.getByText(/Never share your recovery phrase/)).toBeTruthy();
        expect(revealMnemonicRequest).not.toHaveBeenCalled();
        // G130: Reveal Phrase is enabled; an empty password is refused on the press.
        expect(screen.getByRole('button', { name: 'Reveal Phrase' }).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Phrase' }));
        expect(revealMnemonicRequest).not.toHaveBeenCalled();
        expect(screen.getByRole('alert', { name: /form errors/i })).toHaveTextContent('Enter your wallet password.');

        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'hunter22' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal Phrase' }));
        await waitFor(() => expect(revealMnemonicRequest).toHaveBeenCalledWith({ walletId: 'w1', password: 'hunter22' }));

        // The words arrive blurred and clear only on a tap.
        const words = await screen.findByRole('button', { name: 'Reveal recovery phrase' });
        expect(words.style.filter).toBe('blur(8px)');
        fireEvent.click(words);
        expect(screen.getByRole('button', { name: 'Hide recovery phrase' }).style.filter).toBe('none');

        // Done returns to the password step, never to an intro row.
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(await screen.findByLabelText('Wallet password')).toBeTruthy();
        expect(screen.queryByText(/abandon ability/)).toBeNull();
    });

    it('folds a due label batch into the publish page notes instead of a second Publish card', async () => {
        render(
            <MessagingProvider
                shell="web"
                messaging={{
                    labelSyncStatusRequest: vi.fn(async () => ({ due: true, changeCount: 3 })),
                    getAddressesByChain: vi.fn(async () => ({})),
                }}
            >
                <BackupSection activeWallet={WALLET} only="publish" direct />
            </MessagingProvider>,
        );

        expect(await screen.findByText(/3 label changes have not been saved/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Not Now' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Publish Labels' })).toHaveLength(1);
    });
});

describe('Info pages expand nothing in place', () => {
    it('links the full license externally and Back returns from About to Settings', async () => {
        renderSettings();
        fireEvent.click(await screen.findByRole('button', { name: /^About/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Show (Full Text|Preview)/ })).toBeNull();

        const license = screen.getByRole('link', { name: /^License/ });
        expect(license).toHaveAttribute('href', LICENSE_URL);
        expect(license).toHaveAttribute('target', '_blank');
        expect(document.getElementById('full-license-text')).toBeNull();

        back();
        expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    });

    it('opens the log console from Developer options on its own page', async () => {
        renderSettings({ initialSubpageId: 'g-advanced' });
        const options = await screen.findByRole('button', { name: /^Developer options/ });
        await waitFor(() => expect(options.disabled).toBe(false));
        fireEvent.click(options);
        fireEvent.click(await screen.findByRole('button', { name: /Logs and diagnostics console/ }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Logs and Diagnostics Console' })).toBeTruthy();
        expect(await screen.findByTestId('log-console')).toBeTruthy();
        back();
        expect(await screen.findByRole('heading', { level: 1, name: 'Developer Options' })).toBeTruthy();
        back();
        expect(await screen.findByRole('heading', { level: 1, name: 'Advanced' })).toBeTruthy();
    });
});

// The row-list group pages and the catalog sections each one holds.
const ROW_GROUP_PARTS = {
    'g-security': ['wallet-password', 'safety'],
    'g-backup': ['backup', 'contacts'],
    'g-privacy': ['privacy', 'connected-sites'],
    'g-appearance': ['appearance', 'display', 'language-region'],
    'g-notifications': ['notifications'],
    'g-network': ['network', 'network-endpoints', 'fees', 'ads'],
    'g-advanced': ['developer', 'keyboard'],
};

/** Every row on every row-list group page, as { groupId: { title, rows: [{ id, title }] } }. */
async function collectRows() {
    window.xchainWalletUpdater = { install: vi.fn(), onEvent: vi.fn(() => () => {}) };
    // The Desktop notifications row is listed only where notifications exist.
    const hadNotification = 'Notification' in globalThis;
    if (!hadNotification) globalThis.Notification = { permission: 'default', requestPermission: async () => 'default' };
    const out = {};
    for (const groupId of Object.keys(ROW_GROUP_PARTS)) {
        const { container, unmount } = renderSettings({
            initialSubpageId: groupId,
            onNavigateToAdvanced: () => {},
            onNavigateToActionQueue: () => {},
        });
        const heading = await screen.findByRole('heading', { level: 1 });
        await waitFor(() => expect(container.querySelector('[data-settings-row-id]')).toBeTruthy());
        out[groupId] = {
            title: heading.textContent,
            rows: [...container.querySelectorAll('[data-settings-row-id]')].map((li) => ({
                id: li.getAttribute('data-settings-row-id'),
                // An inline row marks its title; a drill-in row's title leads its button's content.
                title: (li.querySelector('[data-settings-row-title]') || li.querySelector('button > span:nth-of-type(2) > span:first-child'))?.textContent,
            })),
        };
        unmount();
    }
    if (!hadNotification) delete globalThis.Notification;
    return out;
}

function searchFor(value) {
    // The search sits behind the header filter button (G04, G95).
    if (!screen.queryByRole('searchbox', { name: 'Search settings' })) {
        fireEvent.click(screen.getByRole('button', { name: 'Filter settings' }));
    }
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value } });
}

function resultButtons() {
    const list = screen.queryByRole('list', { name: 'Search results' });
    return list ? [...list.querySelectorAll('button')] : [];
}

describe('Settings search reaches every setting on the row pages', () => {
    it('maps every cataloged setting on a row-list page to a row that exists', async () => {
        const groups = await collectRows();
        const rowIds = new Set(Object.values(groups).flatMap((g) => g.rows.map((r) => r.id)));
        for (const parts of Object.values(ROW_GROUP_PARTS)) {
            for (const part of parts) {
                const entry = SEARCH_ROW_PAGES[part];
                expect(entry, part).toBeTruthy();
                for (const item of SETTINGS_SEARCH_ROWS[part] || []) {
                    const rowId = typeof entry === 'string' ? entry : (entry[item.title] || entry['*']);
                    expect(rowIds.has(rowId), `${part}: ${item.title} -> ${rowId}`).toBe(true);
                }
            }
        }
    });

    it('finds every row by its own title under the group that lists it', async () => {
        const groups = await collectRows();
        renderSettings();
        for (const group of Object.values(groups)) {
            for (const r of group.rows) {
                searchFor(r.title);
                const hit = resultButtons().some((b) => b.textContent.endsWith(group.title));
                expect(hit, `${r.title} under ${group.title}`).toBe(true);
            }
        }
    });

    it.each([
        ['hide small balances', 'Hide small balances', 'Appearance', 'display-balances'],
        ['explorer url', 'Explorer URL', 'Network and Fees', 'network-endpoints'],
        ['change wallet password', 'Change wallet password', 'Security', 'security-password'],
        ['clipboard', 'Clipboard auto-clear', 'Privacy and Sites', 'privacy-clipboard'],
        ['connected site', 'Connected sites', 'Privacy and Sites', 'connected-sites'],
        ['donation', 'Automatic Donations', 'Network and Fees', 'ads'],
        ['localhost auto sign', 'Localhost auto-sign', 'Advanced', 'advanced-developer-options'],
    ])('"%s" surfaces the %s row on %s', async (query, title, groupTitle, rowId) => {
        renderSettings();
        searchFor(query);
        const result = resultButtons().find((b) => b.textContent === `${title}${groupTitle}`);
        expect(result, `${title} under ${groupTitle}`).toBeTruthy();

        fireEvent.click(result);
        expect(await screen.findByRole('heading', { level: 1, name: groupTitle })).toBeTruthy();
        await waitFor(() => expect(document.querySelector('[data-settings-search-highlight="true"]')).toBeTruthy());
        const highlighted = document.querySelector('[data-settings-search-highlight="true"]');
        expect(highlighted.getAttribute('data-settings-row-id')).toBe(rowId);
        expect(highlighted.querySelector('[data-settings-search-match="true"]')).toBeTruthy();

        // Back from a search hit returns to the Settings list.
        back();
        expect(await screen.findByRole('button', { name: 'Filter settings' })).toBeTruthy();
    });
});
