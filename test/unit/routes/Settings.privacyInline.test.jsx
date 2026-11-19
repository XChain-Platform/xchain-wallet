// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Settings redesign approved 2026-11-13 (wallet-settings-inline.png):
// the menu is eight groups under two headings, and Privacy and Sites changes
// each setting on its row: one switch is a switch on the row, one short
// choice is the themed dropdown on the row, Reset is a button on the row, and
// only Connected sites, with its lists, opens a page. Old pages land on the
// page that replaced them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { PRIVACY_CONTROL_DEFAULTS } from '../../../packages/core/src/shared/components/settings/PrivacySection.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

afterEach(() => {
    cleanup();
    resetBackStackForTests();
});

/** A messaging stub whose settings persist across mounts, as the vault does. */
function harness(initial = createDefaultSettings()) {
    let stored = structuredClone(initial);
    const known = {
        getSettings: vi.fn(async () => structuredClone(stored)),
        updateSettings: vi.fn(async (patch) => {
            stored = {
                ...stored,
                ...patch,
                privacy: patch.privacy ? { ...stored.privacy, ...patch.privacy } : stored.privacy,
            };
            return structuredClone(stored);
        }),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        listBlockedOrigins: vi.fn().mockResolvedValue([]),
        listBlocklistAuditLog: vi.fn().mockResolvedValue([]),
    };
    // Any other call a page makes waits forever rather than failing.
    return new Proxy(known, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string' || property === 'then') return undefined;
            target[property] = vi.fn(() => new Promise(() => {}));
            return target[property];
        },
    });
}

function renderSettings(messaging, props = {}) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <Settings onBack={() => {}} {...props} />
        </MessagingContext.Provider>,
    );
}

/** The row titles of each labelled list on the page, as { label: [titles] }. */
function rowLists(container) {
    return Object.fromEntries([...container.querySelectorAll('ul[role="list"][aria-label]')].map((list) => [
        list.getAttribute('aria-label'),
        [...list.querySelectorAll(':scope > li')].map((li) => (
            li.querySelector('[data-settings-row-title]')
            || li.querySelector('button > span:nth-of-type(2) > span:first-child')
        )?.textContent),
    ]));
}

async function openPrivacy(messaging = harness()) {
    const view = renderSettings(messaging, { initialSubpageId: 'g-privacy' });
    await screen.findByRole('heading', { level: 1, name: 'Privacy and Sites' });
    await screen.findByRole('switch', { name: 'Coin price data' });
    return { ...view, messaging };
}

async function pick(comboboxName, optionName) {
    fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
    fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('the Settings menu', () => {
    it('is About first, then eight groups under Account and Preferences', async () => {
        const { container } = renderSettings(harness());
        await screen.findByRole('button', { name: /^Wallets/ });
        expect(rowLists(container)).toEqual({
            About: ['About'],
            Account: ['Wallets', 'Security', 'Backup and Recovery', 'Privacy and Sites'],
            Preferences: ['Appearance', 'Notifications', 'Network and Fees', 'Advanced'],
        });
        expect(screen.getByText('Tor, connected sites, clipboard, data')).toBeTruthy();
        expect(screen.getByText('Network, fee strategy, donations')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Connected Sites/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Donations/ })).toBeNull();
    });
});

describe('Privacy and Sites', () => {
    it('lists the drawn rows, with only Connected sites and Reset opening a page', async () => {
        const { container } = await openPrivacy();
        expect(rowLists(container)).toEqual({
            'Network and sites': ['Tor routing', 'Coin price data', 'Token metadata', 'Connected sites'],
            // Labels survive restore, Hardware cross-check and Haptic feedback
            // moved to Backup and Recovery, Security and Appearance.
            'Addresses and device': [
                'Change-address rotation',
                'Blur when the window loses focus',
                'Clipboard auto-clear',
                'Form drafts',
                'Reset privacy settings',
            ],
        });
        // Connected sites and Reset privacy settings are the drill-in rows; every other row is inline.
        const drillRows = [...container.querySelectorAll('[data-settings-row-id] > button')];
        expect(drillRows.map((b) => b.closest('li').getAttribute('data-settings-row-id'))).toEqual(['connected-sites', 'privacy-reset']);
        expect(container.querySelectorAll('[data-settings-inline="switch"]')).toHaveLength(5);
        expect(container.querySelectorAll('[data-settings-inline="select"]')).toHaveLength(2);
        // No inline Reset button: the reset row opens its own confirm page.
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
        // Every inline row keeps its ? help tip.
        expect(screen.getByRole('button', { name: 'About Clipboard auto-clear' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Change-address rotation' })).toBeTruthy();
        // A dropdown never draws a native select.
        expect(container.querySelector('select')).toBeNull();
        await waitFor(() => expect(screen.getByText('None connected, none blocked')).toBeTruthy());
    });

    it('groups connected and blocked site counts in the row summary', async () => {
        const messaging = harness();
        messaging.listConnectedSites.mockResolvedValue(Array.from({ length: 1234 }, (_, i) => ({ id: `site-${i}` })));
        messaging.listBlockedOrigins.mockResolvedValue(Array.from({ length: 2500 }, (_, i) => `https://blocked-${i}.example`));
        await openPrivacy(messaging);

        expect(await screen.findByText('1,234 connected, 2,500 blocked')).toBeTruthy();
    });

    it('toggles a switch row in one tap, and the change persists', async () => {
        const messaging = harness();
        await openPrivacy(messaging);
        const blur = screen.getByRole('switch', { name: 'Blur when the window loses focus' });
        expect(blur.checked).toBe(false);
        fireEvent.click(blur);
        await waitFor(() => expect(blur.checked).toBe(true));
        expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { blurOnBlur: true } });
        // Still on the group page: nothing opened.
        expect(screen.getByRole('heading', { level: 1, name: 'Privacy and Sites' })).toBeTruthy();

        cleanup();
        await openPrivacy(messaging);
        expect(screen.getByRole('switch', { name: 'Blur when the window loses focus' }).checked).toBe(true);
    });

    it('flips a switch from a tap on its title too', async () => {
        const messaging = harness();
        await openPrivacy(messaging);
        fireEvent.click(screen.getByText('Change-address rotation'));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Change-address rotation' }).checked).toBe(true));
        expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { changeAddressRotation: true } });
    });

    it('changes the clipboard dropdown in place on the same key', async () => {
        const messaging = harness();
        await openPrivacy(messaging);
        const trigger = screen.getByRole('combobox', { name: 'Clipboard auto-clear' });
        expect(trigger.textContent).toContain('1 minute');
        await pick('Clipboard auto-clear', '5 minutes');
        expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { clipboardAutoClearSeconds: 300 } });
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Clipboard auto-clear' }).textContent).toContain('5 minutes'));
        expect(screen.getByRole('heading', { level: 1, name: 'Privacy and Sites' })).toBeTruthy();

        await pick('Clipboard auto-clear', 'Off');
        expect(messaging.updateSettings).toHaveBeenLastCalledWith({ privacy: { clipboardAutoClearSeconds: 0 } });
    });

    it('keeps a stored clipboard value off the presets as its own choice', async () => {
        const initial = createDefaultSettings();
        initial.privacy.clipboardAutoClearSeconds = 45;
        await openPrivacy(harness(initial));
        expect(screen.getByRole('combobox', { name: 'Clipboard auto-clear' }).textContent).toContain('45 seconds');
        fireEvent.click(screen.getByRole('combobox', { name: 'Clipboard auto-clear' }));
        const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['Off', '30 seconds', '1 minute', '2 minutes', '5 minutes', '10 minutes', '45 seconds']);
    });

    it('changes the form drafts dropdown in place', async () => {
        const messaging = harness();
        await openPrivacy(messaging);
        expect(screen.getByRole('combobox', { name: 'Form drafts' }).textContent).toContain('24 hours');
        await pick('Form drafts', '7 days');
        expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { formDraftTtlMs: 7 * 24 * 60 * 60 * 1000 } });
    });

    it('opens a confirm page from the Reset privacy settings row, with a chevron and no inline button', async () => {
        const initial = createDefaultSettings();
        initial.privacy.blurOnBlur = true;
        const messaging = harness(initial);
        const { container } = await openPrivacy(messaging);
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
        const row = screen.getByRole('button', { name: /^Reset privacy settings/ });
        expect(row.closest('li').querySelector('svg[data-chevron], [data-chevron], [class*="chevron" i]')).toBeTruthy();
        expect(row.textContent).toContain('Restore every privacy default');

        fireEvent.click(row);
        expect(await screen.findByRole('heading', { level: 1, name: 'Reset Privacy Settings' })).toBeTruthy();
        // Opening the page changes nothing: the reset waits for the confirm.
        expect(messaging.updateSettings).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Reset Privacy Settings' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: PRIVACY_CONTROL_DEFAULTS }));
        fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Privacy and Sites' })).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Blur when the window loses focus' }).checked).toBe(false));
        expect(container).toBeTruthy();
    });

    it('opens Connected sites on its own page and Back returns to Privacy and Sites', async () => {
        await openPrivacy();
        fireEvent.click(screen.getByRole('button', { name: /^Connected sites/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Connected Sites' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Privacy and Sites' })).toBeTruthy();
    });
});

describe('old Settings pages land on the page that replaced them', () => {
    it.each([
        'privacy-tor',
        'privacy-clipboard',
        'privacy-form-drafts',
    ])('%s opens Privacy and Sites scrolled to its row', async (id) => {
        renderSettings(harness(), { initialSubpageId: id });
        expect(await screen.findByRole('heading', { level: 1, name: 'Privacy and Sites' })).toBeTruthy();
        await waitFor(() => expect(document.querySelector('[data-settings-search-highlight="true"]')).toBeTruthy());
        expect(document.querySelector('[data-settings-search-highlight="true"]').getAttribute('data-settings-row-id')).toBe(id);
    });

    it('opens Privacy and Sites for the old Privacy page', async () => {
        renderSettings(harness(), { initialSubpageId: 'privacy' });
        expect(await screen.findByRole('heading', { level: 1, name: 'Privacy and Sites' })).toBeTruthy();
    });

    it('opens the Connected Sites page for the old Connected Sites group', async () => {
        renderSettings(harness(), { initialSubpageId: 'g-sites' });
        expect(await screen.findByRole('heading', { level: 1, name: 'Connected Sites' })).toBeTruthy();
    });

    it('opens the donations page for the old Donations group', async () => {
        renderSettings(harness(), { initialSubpageId: 'g-donations' });
        expect(await screen.findByRole('heading', { level: 1, name: 'Automatic Donations' })).toBeTruthy();
    });
});
