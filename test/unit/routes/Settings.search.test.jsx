// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    Settings,
    SETTINGS_SEARCH_ROWS,
    findMatchingSearchRow,
} from '../../../packages/core/src/shared/routes/Settings.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import { ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { writeBalanceCache } from '../../../packages/core/src/shared/utils/balanceCache.js';

function mount(props = {}, loadedSettings = null) {
    const messaging = {
        getSettings: () => loadedSettings ? Promise.resolve(loadedSettings) : new Promise(() => {}),
        updateSettings: vi.fn().mockImplementation(async () => loadedSettings),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }}
                {...props}
            />
        </MessagingContext.Provider>,
    );
}

function searchFor(value) {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), {
        target: { value },
    });
}

// Search results are one row per matching setting: the setting's title with
// the group page that holds it underneath (a group whose own name matches
// shows its section label underneath instead).
function resultRow(title, group) {
    const list = screen.getByRole('list', { name: 'Search results' });
    const row = Array.from(list.querySelectorAll('button')).find((b) => b.textContent === `${title}${group}`);
    return row || null;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete window.xchainWalletUpdater;
});

describe('Settings search', () => {
    it('shows the scoped balance update time in About beside release details', () => {
        writeBalanceCache('wallet-1', null, {
            balances: {},
            fetchedAt: Date.now() - 5 * 60_000,
        }, 'mainnet');
        mount();

        fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));

        expect(screen.getByText('Balances updated')).toBeInTheDocument();
        expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
        expect(screen.getByText('Version')).toBeInTheDocument();
    });

    it('omits redundant inline descriptions and keeps useful ones compact', () => {
        mount();

        expect(screen.queryByText('Choose the theme and motion preference.')).toBeNull();
        expect(screen.queryByText('Choose the interface language and fiat currency.')).toBeNull();
        expect(screen.getByText('Network, endpoints, fee strategy')).toBeTruthy();
        expect(screen.getByText('Payments, orders, deadlines, quiet hours')).toBeTruthy();
        expect(screen.getByText('Wallet password, auto-lock, biometrics, send checks')).toBeTruthy();
    });

    it('points the signer-mode copy at Wallet Details, since wallet mode left Settings', () => {
        expect(en['send.signerMode']).toContain('Wallet Details');
        expect(en['send.signerMode']).not.toContain('Settings');
    });

    it.each([
        ['password', 'Export encrypted backup', 'Backup and Recovery'],
        ['lock', 'Auto-lock timeout', 'Security'],
        ['backup', 'Export encrypted backup', 'Backup and Recovery'],
        ['network', 'Active network', 'Network and Fees'],
        ['currency', 'Fiat currency', 'Appearance'],
        ['language', 'Language', 'Appearance'],
        ['theme', 'Theme', 'Appearance'],
        ['fee', 'Fee strategy', 'Network and Fees'],
        ['fees', 'Fee strategy', 'Network and Fees'],
        ['network fee', 'Fee strategy', 'Network and Fees'],
        ['biometric unlock', 'Biometric unlock', 'Security'],
        ['lock wallet', 'Lock wallet', 'Advanced'],
        ['network endpoint', 'Network and Fees', 'Preferences'],
        ['connected site', 'Connected Sites', 'More'],
        ['donation', 'Automatic Donation System', 'Donations'],
        ['saved network filters', 'Saved network filters', 'Appearance'],
        ['quiet hours', 'Quiet hours', 'Notifications'],
        ['localhost auto sign', 'Cache password for localhost auto-sign', 'Advanced'],
    ])('finds "%s" as %s under %s', (query, title, group) => {
        mount();
        searchFor(query);

        expect(resultRow(title, group), `${title} under ${group}`).toBeTruthy();
        expect(screen.queryByText('About')).toBeNull();
    });

    it('shows the active wallet name on the Wallets page', () => {
        const onOpenWalletPicker = vi.fn();
        mount({ onOpenWalletPicker });

        fireEvent.click(screen.getByRole('button', { name: /^Wallets/ }));
        const row = screen.getByRole('button', { name: /My Wallets/ });

        expect(row).toHaveTextContent('Primary Vault');
        fireEvent.click(row);
        expect(onOpenWalletPicker).toHaveBeenCalledTimes(1);
    });

    it('finds every cataloged settings row by its title', () => {
        for (const [sectionId, rows] of Object.entries(SETTINGS_SEARCH_ROWS)) {
            for (const { title } of rows) {
                expect(findMatchingSearchRow(sectionId, title), title).toMatchObject({ title });
            }
        }
    });

    it.each([
        ['wallet', 'Wallets'],
        ['network endpoint', 'Network and Fees'],
        ['connected site', 'Connected Sites'],
        ['donation', 'Donations'],
        ['localhost auto sign', 'Advanced'],
    ])('exposes the %s drilldown as the %s page', (query, groupTitle) => {
        mount();
        searchFor(query);

        expect(screen.getAllByRole('button', {
            name: new RegExp(`${groupTitle}`),
        }).length).toBeGreaterThan(0);
    });

    it('opens a matching drilldown section', () => {
        mount();
        searchFor('password');

        fireEvent.click(resultRow('Export encrypted backup', 'Backup and Recovery'));

        expect(screen.getByRole('heading', { name: /Backup and Recovery/i })).toBeTruthy();
        expect(screen.getByText('Wallet backup')).toBeTruthy();
        expect(screen.getByText('Encrypted backup file')).toBeTruthy();
    });

    it('opens the matching subpage and highlights its row', async () => {
        const settings = createDefaultSettings();
        settings.fees['bitcoin-mainnet'] = { strategy: 'normal', customRate: null, rbfByDefault: false };
        mount({}, settings);
        searchFor('network fee');

        fireEvent.click(resultRow('Fee strategy', 'Network and Fees'));

        expect(await screen.findByRole('heading', { name: /Network and Fees/i })).toBeTruthy();
        const match = await screen.findByText('Fee strategy', {
            selector: '[data-settings-search-match="true"]',
        });
        expect(match.closest('[data-settings-search-highlight="true"]')).toBeTruthy();
    });

    it('does not add generic copy beneath Appearance', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: /^Appearance/ }));

        expect(screen.getAllByRole('heading', { name: 'Appearance' }).length).toBeGreaterThan(0);
        expect(screen.queryByText(/wallet theme|interface animation/i)).toBeNull();
        expect(screen.queryByText(/accent color/i)).toBeNull();
    });

    it('starts drilldowns at the top and restores the settings list position', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
                <ScrollRestoration routeKey="settings">
                    <Settings onBack={() => {}} />
                </ScrollRestoration>
            </MessagingContext.Provider>,
        );
        const main = document.getElementById('xc-main');
        main.scrollTop = 418;

        fireEvent.click(screen.getByRole('button', { name: /Network and Fees/ }));

        expect(main.scrollTop).toBe(0);
        main.scrollTop = 73;
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(main.scrollTop).toBe(418);

        fireEvent.click(screen.getByRole('button', { name: /Network and Fees/ }));
        expect(main.scrollTop).toBe(0);
    });

    it('shows a plain empty state for no match and clearing restores the list', () => {
        mount();
        searchFor('no setting has these words');

        // A section still loading shows its own status row, so find the search one by its words.
        expect(screen.getAllByRole('status').find((el) => /No settings match/.test(el.textContent)))
            .toHaveTextContent('No settings match "no setting has these words".');
        expect(screen.queryByText('Backup and Recovery')).toBeNull();

        searchFor('');

        expect(screen.queryByText(/No settings match/)).toBeNull();
        expect(screen.getByText('Backup and Recovery')).toBeTruthy();
        expect(screen.getByText('Advanced')).toBeTruthy();
    });

    it('shows the empty state when the only text match belongs to an unavailable row', () => {
        mount({ activeWallet: null, onOpenAccountPicker: undefined });
        searchFor('signer pairing');

        expect(screen.getAllByRole('status').find((el) => /No settings match/.test(el.textContent)))
            .toHaveTextContent('No settings match "signer pairing".');
    });

});
