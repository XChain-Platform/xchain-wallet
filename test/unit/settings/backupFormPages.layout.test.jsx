// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Backup and Recovery's form pages (operator walk 2026-11-15): each is a plain
// Form Standard page, never a form wrapped whole in one card on a phone. The
// page's notice (G120) is the first item of the form column (U15), then the
// fields, then the one button. Check network for backed-up contacts carries a
// short header title (G01) and its full name moves into its notice.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const SETTINGS = createDefaultSettings();
const CHAIN_ID = 'bitcoin-testnet';

function pending() {
    return new Promise(() => {});
}

function settingsMessaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [{ id: 'a1', address: 'tb1qbackupformpages0000000000000000000', source: 'hd' }] }),
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

function renderPage(id) {
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging: settingsMessaging() }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                initialSubpageId={id}
            />
        </MessagingContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

/** True when `a` comes before `b` in document order. */
function before(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * The settings surface around the page is a form frame (G126): no card around
 * the whole form at phone and popup widths, one card from 600px. jsdom cannot
 * evaluate the media query, so the frame mode is read from the surface and
 * the narrow rule itself is checked in test/unit/settings/formFrame.test.jsx.
 */
function expectNoWrappingCard(container) {
    const surface = container.querySelector('[data-settings-section]');
    expect(surface).not.toBeNull();
    expect(surface.getAttribute('data-settings-frame')).toBe('form');
    // No inline flat style: the card comes back at iPad and desktop widths.
    expect(surface.style.border).toBe('');
    expect(surface.style.padding).toBe('');
    // No note card (WarningCard) is left on the page either.
    expect(container.querySelector('[data-warning-line]')).toBeNull();
}

const PAGES = [
    {
        id: 'backup-export',
        title: 'Encrypted Backup File',
        notice: () => screen.getByTestId('export-backup-note'),
        field: () => screen.getByLabelText('Backup password'),
        button: () => screen.getByRole('button', { name: 'Export Backup' }),
    },
    {
        id: 'backup-phrase',
        title: 'Recovery Phrase',
        notice: () => screen.getByTestId('reveal-phrase-note'),
        field: () => screen.getByLabelText('Wallet password'),
        button: () => screen.getByRole('button', { name: 'Reveal Phrase' }),
    },
    {
        id: 'backup-test',
        title: 'Test Backup',
        notice: () => screen.getByTestId('test-backup-note'),
        field: () => screen.getByLabelText('Recovery phrase to test'),
        button: () => screen.getByRole('button', { name: 'Run Test' }),
    },
    {
        id: 'backup-publish',
        title: 'Publish Labels On-Chain',
        notice: () => screen.getByTestId('publish-labels-note'),
        field: () => screen.getByRole('button', { name: /^Network: / }),
        button: () => screen.getByRole('button', { name: 'Publish Labels' }),
    },
    {
        id: 'backup-restore',
        title: 'Restore Contacts',
        notice: () => screen.getByTestId('restore-contacts-note'),
        field: () => screen.getByRole('button', { name: /^Network: / }),
        button: () => screen.getByRole('button', { name: 'Check for Contacts' }),
    },
];

describe('Backup and Recovery form pages', () => {
    it.each(PAGES)('$id is a plain form page: notice, fields, then the button, with no wrapping card', async (page) => {
        const { container } = renderPage(page.id);
        await screen.findByRole('heading', { level: 1, name: page.title });
        const field = await vi.waitFor(() => page.field());
        const notice = page.notice();
        const button = page.button();
        expectNoWrappingCard(container);
        // A Notice Standard notice (G120), there from the first paint, not an error alert.
        expect(notice.getAttribute('data-tone')).toMatch(/^(info|danger)$/);
        expect(notice.getAttribute('role')).not.toBe('alert');
        // Top of the form column (U15): inside the same form as the fields.
        const form = notice.closest('form, [role="group"]');
        expect(form).not.toBeNull();
        expect(form.contains(field)).toBe(true);
        expect(form.contains(button)).toBe(true);
        expect(before(notice, field)).toBe(true);
        expect(before(field, button)).toBe(true);
    });

    it('titles the restore page with a short Title Case title and keeps the full name in its notice', async () => {
        renderPage('backup-restore');
        const heading = await screen.findByRole('heading', { level: 1, name: 'Restore Contacts' });
        expect(heading.textContent.split(/\s+/).length).toBeLessThanOrEqual(3);
        const notice = await vi.waitFor(() => screen.getByTestId('restore-contacts-note'));
        expect(within(notice).getByText('Check network for backed-up contacts')).toBeTruthy();
        expect(notice.textContent).toMatch(/Decrypts the labels \+ contacts FILE/);
        expect(screen.queryByRole('heading', { level: 1, name: /Check Network/i })).toBeNull();
    });

    it('keeps the phrase warning and the page note in the one notice at the top', async () => {
        renderPage('backup-phrase');
        const notice = await vi.waitFor(() => screen.getByTestId('reveal-phrase-note'));
        expect(notice.getAttribute('data-tone')).toBe('danger');
        expect(notice.textContent).toContain('Never share your recovery phrase.');
        expect(notice.textContent).toContain('Make sure no one is looking over your shoulder.');
    });

    it('draws Export contacts as the label, the format dropdown, its note and the Export button', async () => {
        const { container } = renderPage('backup-contacts-export');
        await screen.findByRole('heading', { level: 1, name: 'Export Contacts' });
        expectNoWrappingCard(container);
        const form = screen.getByRole('form', { name: /export contacts/i });
        const dropdown = within(form).getByRole('button', { name: /^File format/ });
        const note = within(form).getByText('Neither format is encrypted.');
        const button = within(form).getByRole('button', { name: 'Export' });
        expect(before(dropdown, note)).toBe(true);
        expect(before(note, button)).toBe(true);
    });
});
