// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Settings redesign approved group by group on 2026-11-13: Security,
// Backup and Recovery, Appearance and Notifications change each one-switch,
// one-choice or one-action setting on its row, writing the same keys as the
// pages they replaced, and old page ids land on the row that took over.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import {
    clearPanicModeState,
    getPanicModeState,
    getPanicRemainingMs,
} from '../../../packages/core/src/flows/panicMode.js';

const biometric = vi.hoisted(() => ({ registered: false, supported: true }));
vi.mock('../../../packages/core/src/flows/biometricUnlock.js', async (importOriginal) => ({
    ...(await importOriginal()),
    describeBiometric: vi.fn(async () => ({
        supported: biometric.supported,
        reason: 'Nothing is enrolled.',
        mechanism: 'your fingerprint',
        wrapNote: '',
    })),
    isBiometricRegistered: vi.fn(() => biometric.registered),
    registerBiometricCredential: vi.fn(async () => { biometric.registered = true; }),
    clearBiometricCredential: vi.fn(async () => { biometric.registered = false; }),
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

const realNotification = globalThis.Notification;

beforeEach(() => {
    biometric.registered = false;
    biometric.supported = true;
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    if (realNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = realNotification;
});

const NESTED = ['privacy', 'grace', 'notifications'];

/** A messaging stub whose settings persist across mounts, merging nested blocks as the vault does. */
function harness(initial = createDefaultSettings()) {
    let stored = structuredClone(initial);
    const known = {
        getSettings: vi.fn(async () => structuredClone(stored)),
        updateSettings: vi.fn(async (patch) => {
            const next = { ...stored, ...patch };
            for (const key of NESTED) if (patch[key]) next[key] = { ...stored[key], ...patch[key] };
            stored = next;
            return structuredClone(stored);
        }),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        listBlockedOrigins: vi.fn().mockResolvedValue([]),
        listContacts: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Ann', entries: [] }]),
        unlockWallet: vi.fn().mockResolvedValue(true),
    };
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
            <Settings onBack={() => {}} activeWallet={{ id: 'w1', name: 'Main' }} {...props} />
        </MessagingContext.Provider>,
    );
}

function rowLists(container) {
    return Object.fromEntries([...container.querySelectorAll('ul[role="list"][aria-label]')].map((list) => [
        list.getAttribute('aria-label'),
        [...list.querySelectorAll(':scope > li')].map((li) => (
            li.querySelector('[data-settings-row-title]')
            || li.querySelector('button > span:nth-of-type(2) > span:first-child')
        )?.textContent),
    ]));
}

function drillRows(container) {
    return [...container.querySelectorAll('[data-settings-row-id] > button')]
        .map((button) => button.closest('li').getAttribute('data-settings-row-id'));
}

async function pick(comboboxName, optionName) {
    fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
    fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

async function openGroup(id, messaging = harness(), props = {}) {
    const view = renderSettings(messaging, { initialSubpageId: id, ...props });
    await waitFor(() => expect(view.container.querySelector('[data-settings-inline]')).toBeTruthy());
    return { ...view, messaging };
}

describe('Security', () => {
    afterEach(() => clearPanicModeState());

    it('lays out the drawn rows; Wallet password, Panic mode and Duress passphrase open pages', async () => {
        const { container } = await openGroup('g-security');
        await screen.findByRole('combobox', { name: 'Auto-lock' });
        expect(rowLists(container)).toEqual({
            Unlocking: ['Wallet password', 'Auto-lock', 'Biometric unlock'],
            Sending: ['New-recipient test send', 'Lookalike address warnings', 'Hold sends before broadcast', 'Hardware cross-check'],
            Emergency: ['Panic mode', 'Duress passphrase'],
        });
        expect(drillRows(container)).toEqual(['security-password', 'security-panic', 'security-duress']);
        // Panic mode is a chevron row: title and line, no Activate, Cancel or Confirm on it.
        const panic = container.querySelector('[data-settings-row-id="security-panic"]');
        expect(panic.textContent).toContain('Freeze all signing for 24 hours');
        expect(within(panic).queryByRole('button', { name: /Activate|Cancel|Confirm/ })).toBeNull();
        // Lookalike warnings is a switch, on by default.
        expect(screen.getByRole('switch', { name: 'Lookalike address warnings' }).checked).toBe(true);
    });

    it('changes Auto-lock, test send and Hold sends in place on their keys', async () => {
        const { messaging } = await openGroup('g-security');
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Auto-lock' }).disabled).toBe(false));
        await pick('Auto-lock', '1 hour');
        expect(messaging.updateSettings).toHaveBeenCalledWith({ autolockMinutes: 60 });

        // The threshold is in the display currency (operator ruling 2026-11-14).
        expect(screen.getByRole('combobox', { name: 'New-recipient test send' }).textContent).toContain('Off');
        fireEvent.click(screen.getByRole('combobox', { name: 'New-recipient test send' }));
        const offered = (await screen.findAllByRole('option')).map((o) => o.textContent);
        expect(offered).toEqual(['Off', '$100', '$1,000', '$10,000', '$100,000', 'Custom']);
        fireEvent.click(screen.getByRole('option', { name: '$1,000' }));
        expect(messaging.updateSettings).toHaveBeenCalledWith({ grace: { testSendThresholdFiat: '1000' } });

        // Short labels: Off, 5 s, 10 s, 20 s, 30 s.
        fireEvent.click(screen.getByRole('combobox', { name: 'Hold sends before broadcast' }));
        expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Off', '5 s', '10 s', '20 s', '30 s']);
        fireEvent.click(screen.getByRole('option', { name: '10 s' }));
        expect(messaging.updateSettings).toHaveBeenCalledWith({ grace: { undoSendEnabled: true, undoSendSeconds: 10 } });
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Hold sends before broadcast' }).textContent).toContain('10 s'));
        await pick('Hold sends before broadcast', 'Off');
        expect(messaging.updateSettings).toHaveBeenLastCalledWith({ grace: { undoSendEnabled: false } });
        // Nothing opened: still the group page.
        expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
    });

    it('opens a custom test-send amount field in place and saves a valid amount', async () => {
        const { messaging } = await openGroup('g-security');
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'New-recipient test send' }).disabled).toBe(false));
        await pick('New-recipient test send', 'Custom');
        const field = await screen.findByLabelText('Custom amount (USD)');
        fireEvent.change(field, { target: { value: '12.345' } });
        fireEvent.blur(field);
        expect(await screen.findByText('Enter an amount above zero, with at most two decimals.')).toBeTruthy();
        expect(messaging.updateSettings).not.toHaveBeenCalledWith({ grace: { testSendThresholdFiat: '12.345' } });
        fireEvent.change(field, { target: { value: '2,500.50' } });
        fireEvent.blur(field);
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ grace: { testSendThresholdFiat: '2500.5' } }));
        // Still on the row: the page did not change.
        expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
    });

    it('shows a stored amount off the presets as Custom with its field open', async () => {
        const initial = createDefaultSettings();
        initial.grace.testSendThresholdFiat = '250';
        await openGroup('g-security', harness(initial));
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'New-recipient test send' }).textContent).toContain('Custom'));
        expect(screen.getByLabelText('Custom amount (USD)').value).toBe('250');
    });

    it('turns lookalike address warnings off and on with its switch', async () => {
        const { messaging } = await openGroup('g-security');
        const toggle = await screen.findByRole('switch', { name: 'Lookalike address warnings' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        fireEvent.click(toggle);
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ grace: { lookalikeWarnings: false } }));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Lookalike address warnings' }).checked).toBe(false));
        fireEvent.click(screen.getByRole('switch', { name: 'Lookalike address warnings' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenLastCalledWith({ grace: { lookalikeWarnings: true } }));
    });

    it('opens the Panic Mode confirm page; Back returns without a freeze', async () => {
        await openGroup('g-security');
        fireEvent.click(await screen.findByRole('button', { name: /^Panic mode/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Panic Mode' })).toBeTruthy();
        const notice = screen.getByTestId('panic-freeze-notice');
        expect(notice.getAttribute('data-tone')).toBe('danger');
        expect(within(notice).getByText('Everything freezes for 24 hours')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Confirm 24-Hour Freeze' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
        expect(getPanicRemainingMs(getPanicModeState())).toBe(0);
    });

    it('confirms the 24-hour freeze, shows it active on Security, and deactivates from its page', async () => {
        await openGroup('g-security');
        fireEvent.click(await screen.findByRole('button', { name: /^Panic mode/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm 24-Hour Freeze' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
        expect(getPanicRemainingMs(getPanicModeState())).toBeGreaterThan(0);
        const row = await screen.findByRole('button', { name: /^Panic mode/ });
        expect(row.textContent).toMatch(/Active, 24h left\. Open to deactivate\./);

        fireEvent.click(row);
        expect(await screen.findByText('Panic mode is active')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Confirm 24-Hour Freeze' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
        expect(getPanicRemainingMs(getPanicModeState())).toBe(0);
        expect((await screen.findByRole('button', { name: /^Panic mode/ })).textContent).toContain('Freeze all signing for 24 hours');
    });

    it('turns Biometric unlock on through the Enable Biometric Unlock page', async () => {
        const { messaging } = await openGroup('g-security');
        const toggle = await screen.findByRole('switch', { name: 'Biometric unlock' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        fireEvent.click(toggle);
        // A page of its own, never a form on the Security page.
        expect(await screen.findByRole('heading', { level: 1, name: 'Enable Biometric Unlock' })).toBeTruthy();
        const password = await screen.findByLabelText('Wallet password');
        expect(screen.queryByRole('dialog')).toBeNull();
        const enable = screen.getByRole('button', { name: 'Enable Biometric Unlock' });
        expect(enable.className).toMatch(/success/);
        fireEvent.change(password, { target: { value: 'pw' } });
        fireEvent.click(enable);
        expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
        expect(messaging.unlockWallet).toHaveBeenCalledWith('pw');
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Biometric unlock' }).checked).toBe(true));
    });

    it('returns with Biometric unlock off after Back from the Enable page', async () => {
        await openGroup('g-security');
        const toggle = await screen.findByRole('switch', { name: 'Biometric unlock' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        fireEvent.click(toggle);
        await screen.findByRole('heading', { level: 1, name: 'Enable Biometric Unlock' });
        fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Biometric unlock' }).disabled).toBe(false));
        expect(screen.getByRole('switch', { name: 'Biometric unlock' }).checked).toBe(false);
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
    });

    it('returns with Biometric unlock off and the reason when enrolment fails', async () => {
        const flows = await import('../../../packages/core/src/flows/biometricUnlock.js');
        flows.registerBiometricCredential.mockImplementationOnce(async () => { throw new Error('The device refused the credential.'); });
        await openGroup('g-security');
        const toggle = await screen.findByRole('switch', { name: 'Biometric unlock' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        fireEvent.click(toggle);
        fireEvent.change(await screen.findByLabelText('Wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enable Biometric Unlock' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
        expect(await screen.findByText(/Biometric unlock wasn't turned on\. The device refused the credential\./)).toBeTruthy();
        expect(screen.getByRole('switch', { name: 'Biometric unlock' }).checked).toBe(false);
    });

    it('keeps the Enable page open on a wrong password', async () => {
        const messaging = harness();
        messaging.unlockWallet.mockImplementationOnce(async () => {
            const err = new Error('bad');
            err.name = 'InvalidPasswordError';
            throw err;
        });
        await openGroup('g-security', messaging);
        const toggle = await screen.findByRole('switch', { name: 'Biometric unlock' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        fireEvent.click(toggle);
        fireEvent.change(await screen.findByLabelText('Wallet password'), { target: { value: 'nope' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enable Biometric Unlock' }));
        expect(await screen.findByText('Incorrect wallet password.')).toBeTruthy();
        expect(screen.getByRole('heading', { level: 1, name: 'Enable Biometric Unlock' })).toBeTruthy();
    });

    it('turns Biometric unlock off with no password and removes the stored credential', async () => {
        biometric.registered = true;
        await openGroup('g-security');
        const toggle = await screen.findByRole('switch', { name: 'Biometric unlock' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        expect(toggle.checked).toBe(true);
        const flows = await import('../../../packages/core/src/flows/biometricUnlock.js');
        fireEvent.click(toggle);
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Biometric unlock' }).checked).toBe(false));
        expect(flows.clearBiometricCredential).toHaveBeenCalled();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
    });

    it('leaves Biometric unlock off and disabled where the device cannot use it', async () => {
        biometric.supported = false;
        await openGroup('g-security');
        await waitFor(() => expect(screen.getByText('Not available on this device')).toBeTruthy());
        expect(screen.getByRole('switch', { name: 'Biometric unlock' }).disabled).toBe(true);
    });
});

describe('Backup and Recovery', () => {
    it('lays out the drawn rows; the five forms open pages', async () => {
        const { container } = await openGroup('g-backup');
        expect(rowLists(container)).toEqual({
            'Wallet backup': ['Encrypted backup file', 'Recovery phrase', 'Test backup'],
            'Labels and contacts': ['Labels survive restore', 'Publish labels on-chain', 'Restore contacts', 'Export contacts', 'Import contacts'],
        });
        // Both contacts rows are chevron rows: no button sits inside either.
        expect(drillRows(container)).toEqual(['backup-export', 'backup-phrase', 'backup-test', 'backup-publish', 'backup-restore', 'backup-contacts-export', 'backup-contacts-import']);
        for (const id of ['backup-contacts-export', 'backup-contacts-import']) {
            const li = container.querySelector(`[data-settings-row-id="${id}"]`);
            expect(li.querySelectorAll('button')).toHaveLength(1);
            expect(li.querySelector('button').querySelector('svg')).not.toBeNull();
        }
        // The reminders stay automatic; they have no row (2026-11-14).
        expect(container.querySelector('[data-settings-row-id="backup-reminders"]')).toBeNull();
        expect(screen.queryByText('Backup reminders')).toBeNull();
    });

    it('opens the Export contacts page from its chevron row and downloads the chosen format', async () => {
        const createObjectURL = vi.fn(() => 'blob:contacts');
        const revokeObjectURL = vi.fn();
        const realCreate = URL.createObjectURL;
        const realRevoke = URL.revokeObjectURL;
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        try {
            const { container } = await openGroup('g-backup');
            fireEvent.click(container.querySelector('[data-settings-row-id="backup-contacts-export"] button'));
            expect(await screen.findByRole('heading', { level: 1, name: 'Export Contacts' })).toBeTruthy();
            expect(screen.getByRole('button', { name: /back/i })).toBeTruthy();
            // JSON first and chosen; the format is the themed dropdown with an
            // icon per option, never radios (G119).
            expect(screen.queryAllByRole('radio')).toHaveLength(0);
            const formatField = () => screen.getByRole('button', { name: /^File format: / });
            expect(formatField()).toHaveAccessibleName('File format: JSON File');
            fireEvent.click(formatField());
            const choices = screen.getAllByRole('option');
            expect(choices.map((o) => o.textContent.trim())).toEqual(['JSON File', 'CSV File']);
            for (const option of choices) expect(option.querySelector('svg')).not.toBeNull();
            fireEvent.click(choices[0]);
            expect(screen.getByText('Neither format is encrypted.')).toBeTruthy();
            const exportButton = await screen.findByRole('button', { name: 'Export' });
            await waitFor(() => expect(exportButton.disabled).toBe(false));
            expect(exportButton.getAttribute('type')).toBe('submit');
            expect(exportButton.querySelector('svg')).not.toBeNull();
            fireEvent.click(exportButton);
            await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
            expect(createObjectURL.mock.calls[0][0].type).toBe('application/json');
            fireEvent.click(formatField());
            fireEvent.click(screen.getByRole('option', { name: 'CSV File' }));
            fireEvent.click(exportButton);
            await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
            expect(createObjectURL.mock.calls[1][0].type).toBe('text/csv;charset=utf-8');
        } finally {
            URL.createObjectURL = realCreate;
            URL.revokeObjectURL = realRevoke;
        }
    });

    it('keeps Export disabled when the address book is empty', async () => {
        const messaging = harness();
        messaging.listContacts.mockResolvedValue([]);
        const { container } = await openGroup('g-backup', messaging);
        fireEvent.click(container.querySelector('[data-settings-row-id="backup-contacts-export"] button'));
        const exportButton = await screen.findByRole('button', { name: 'Export' });
        await waitFor(() => expect(exportButton.disabled).toBe(true));
    });

    it('opens the file picker when the Import contacts row is tapped', async () => {
        const { container } = await openGroup('g-backup');
        const input = container.querySelector('[data-settings-row-id="backup-contacts-import"] input[type="file"]');
        const click = vi.spyOn(input, 'click');
        fireEvent.click(container.querySelector('[data-settings-row-id="backup-contacts-import"] button'));
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('imports contacts from a picked file behind the replace confirmation', async () => {
        const { container } = await openGroup('g-backup');
        const input = container.querySelector('[data-settings-row-id="backup-contacts-import"] input[type="file"]');
        expect(input.getAttribute('accept')).toBe('application/json,text/csv,.json,.csv');
        // A file-like object: jsdom's File has no text() reader.
        const file = { name: 'contacts.json', type: 'application/json', size: 2, text: async () => '[]' };
        fireEvent.change(input, { target: { files: [file] } });
        expect(await screen.findByText('Import contacts?')).toBeTruthy();
    });

    it('toggles Labels survive restore on its row', async () => {
        const { messaging } = await openGroup('g-backup');
        const toggle = await screen.findByRole('switch', { name: 'Labels survive restore' });
        await waitFor(() => expect(toggle.disabled).toBe(false));
        fireEvent.click(toggle);
        await waitFor(() => expect(toggle.checked).toBe(true));
        expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { labelsSurviveRestore: true } });
    });
});

describe('Appearance', () => {
    const rowButton = (container, id) => container.querySelector(`[data-settings-row-id="${id}"] > button`);
    const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    const appearanceHeading = () => screen.findByRole('heading', { level: 1, name: 'Appearance' });
    // Opens a row's page from Appearance, as a tap does, so Back and a pick return there.
    const openFromAppearance = async (id, messaging = harness()) => {
        const view = await openGroup('g-appearance', messaging);
        await waitFor(() => expect(rowButton(view.container, id)).toBeTruthy());
        fireEvent.click(rowButton(view.container, id));
        return view;
    };
    // The standard rounded list card (walk 2026-11-15): the group lists'
    // inline surface, since the Settings page surface strips a class card.
    const expectListCard = (list) => {
        const style = list.getAttribute('style') || '';
        expect(style).toMatch(/border:\s*1px solid var\(--xc-border\)/);
        expect(style).toMatch(/border-radius:\s*var\(--xc-radius-md\)/);
        expect(style).toMatch(/background:\s*var\(--xc-surface\)/);
    };

    // Every value row shows its current value and a chevron, opens its own
    // page, and Back returns to Appearance (operator rulings 2026-11-14).
    it.each([
        ['appearance-theme', 'System default', 'Theme'],
        ['appearance-language', 'English', 'Language'],
        ['appearance-currency', 'US Dollar (USD)', 'Fiat Currency'],
        ['display-balances', 'Off', 'Hide Small Balances'],
        ['display-number-format', '1,234.56780000', 'Number Format'],
        ['display-lists', 'Each list forgets the network you last picked and shows all networks again', 'Clear Remembered Network Filters'],
        ['display-reset', 'Puts theme, language, currency, number format and the options on this page back to their defaults', 'Reset Display Settings'],
    ])('the %s row shows %s with a chevron and opens %s; Back returns', async (id, value, title) => {
        const { container } = await openGroup('g-appearance');
        await waitFor(() => expect(rowButton(container, id).textContent).toContain(value));
        const button = rowButton(container, id);
        // The chevron is the row's last part, an icon after the value.
        expect(button.lastElementChild.querySelector('svg')).not.toBeNull();
        expect(button.lastElementChild.textContent).toBe('');
        expect(within(button).queryByRole('combobox')).toBeNull();
        fireEvent.click(button);
        expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
        // A page, never a modal (G104).
        expect(screen.queryByRole('dialog')).toBeNull();
        back();
        expect(await appearanceHeading()).toBeTruthy();
    });

    it('lists the themes as rows with a check on the chosen one, and a pick persists', async () => {
        const messaging = harness();
        await openFromAppearance('appearance-theme', messaging);
        const list = await screen.findByRole('list', { name: 'Themes' });
        // The rows sit in the standard rounded list card.
        expectListCard(list);
        const rows = within(list).getAllByRole('button');
        expect(rows.map((r) => r.querySelector('span:nth-of-type(2) > span:first-child').textContent)).toEqual(['System default', 'Light', 'Dark']);
        const current = () => within(list).getAllByRole('button').filter((r) => r.getAttribute('aria-current') === 'true');
        expect(current()).toHaveLength(1);
        expect(current()[0].textContent).toContain('System default');
        expect(current()[0].querySelector('[data-settings-choice-check] svg')).not.toBeNull();
        // No radios (G119).
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        fireEvent.click(within(list).getByRole('button', { name: /^Dark/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ theme: 'dark' }));
        // Theme stays open so the new look shows with the check moved.
        await waitFor(() => expect(current()[0].textContent).toContain('Dark'));
        expect(screen.getByRole('heading', { level: 1, name: 'Theme' })).toBeTruthy();
        expect(document.querySelectorAll('[data-settings-choice-check]')).toHaveLength(1);
        back();
        expect(await appearanceHeading()).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('button', { name: /^Theme/ }).textContent).toContain('Dark'));
        fireEvent.click(screen.getByRole('button', { name: /^Theme/ }));
        const reopened = await screen.findByRole('list', { name: 'Themes' });
        await waitFor(() => expect(within(reopened).getByRole('button', { name: /^Dark/ }).getAttribute('aria-current')).toBe('true'));
    });

    it('lists every language with native and English names; a pick returns to Appearance', async () => {
        const messaging = harness();
        await openFromAppearance('appearance-language', messaging);
        const list = await screen.findByRole('list', { name: 'Languages' });
        // Even one language sits in the standard rounded list card.
        expectListCard(list);
        const english = within(list).getByRole('button', { name: /^English/ });
        expect(english.getAttribute('aria-current')).toBe('true');
        // No inline search field; the search sits behind the header filter button.
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.getByRole('banner').contains(screen.getByRole('button', { name: 'Filter languages' }))).toBe(true);
        fireEvent.click(english);
        expect(await appearanceHeading()).toBeTruthy();
        // The language already in use saves nothing.
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('saves a new language after its translations load, then returns', async () => {
        const { setLocale } = await import('../../../packages/core/src/i18n/index.js');
        const initial = createDefaultSettings();
        initial.developerMode = true;
        const messaging = harness(initial);
        try {
            await openFromAppearance('appearance-language', messaging);
            const list = await screen.findByRole('list', { name: 'Languages' });
            const pseudo = within(list).getAllByRole('button').find((r) => r.textContent.includes('pseudo-rtl'));
            expect(pseudo).toBeTruthy();
            fireEvent.click(pseudo);
            await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ language: 'pseudo-rtl' }));
            await waitFor(() => expect(document.querySelector('[data-settings-row-id="appearance-language"]')).toBeTruthy());
            await waitFor(() => expect(document.querySelector('[data-settings-row-id="appearance-language"] button').textContent).toContain('pseudo-rtl'));
        } finally {
            await setLocale('en');
        }
    });

    it('filters the languages from the header filter button: tap, the search box appears, typing narrows the list', async () => {
        const initial = createDefaultSettings();
        // Developer mode adds the pseudo-RTL test locale, so there are two rows to narrow.
        initial.developerMode = true;
        await openFromAppearance('appearance-language', harness(initial));
        const rows = () => within(screen.getByRole('list', { name: 'Languages' })).getAllByRole('button').map((r) => r.textContent);
        await waitFor(() => expect(rows()).toHaveLength(2));
        expect(screen.queryByRole('searchbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Filter languages' }));
        const search = await screen.findByRole('searchbox', { name: 'Search languages' });
        fireEvent.change(search, { target: { value: 'pseudo' } });
        expect(rows()).toEqual([expect.stringContaining('pseudo-rtl')]);
        fireEvent.change(search, { target: { value: 'english' } });
        expect(rows()).toEqual([expect.stringContaining('English')]);
        fireEvent.change(search, { target: { value: 'zzz' } });
        expect(await screen.findByText('No languages match.')).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Languages' })).toBeNull();
    });

    it('picks a fiat currency on the shared Fiat currency picker (symbol, code, name); the pick returns and persists', async () => {
        const messaging = harness();
        await openFromAppearance('appearance-currency', messaging);
        const list = await screen.findByRole('list', { name: 'Fiat currencies' });
        // The shared picker page (G122), its list in one rounded card that no
        // outer card flattens (the page draws its own screen, outside the
        // Settings card surface).
        expect(list.hasAttribute('data-fiat-currency-picker')).toBe(true);
        expect(list.closest('[data-settings-section]')).toBeNull();
        const usd = within(list).getByRole('button', { name: /^USD/ });
        expect(usd.getAttribute('aria-current')).toBe('true');
        expect(usd.textContent).toContain('US Dollar');
        expect(usd.textContent).toContain('$');
        // The inline "Search by code or name" field is gone: no search box
        // until the header filter button opens it.
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.queryByPlaceholderText('Search by code or name')).toBeNull();
        const filter = screen.getByRole('button', { name: 'Filter currencies' });
        expect(screen.getByRole('banner').contains(filter)).toBe(true);
        fireEvent.click(filter);
        const search = await screen.findByRole('searchbox', { name: 'Search currencies' });
        fireEvent.change(search, { target: { value: 'eur' } });
        const shown = () => within(screen.getByRole('list', { name: 'Fiat currencies' })).getAllByRole('button').map((r) => r.textContent);
        expect(shown()).toContainEqual(expect.stringContaining('EUR'));
        expect(shown().some((text) => text.includes('USD'))).toBe(false);
        fireEvent.change(search, { target: { value: 'zzz' } });
        expect(await screen.findByText('No matching currencies')).toBeTruthy();
        fireEvent.change(search, { target: { value: 'euro' } });
        fireEvent.click(within(screen.getByRole('list', { name: 'Fiat currencies' })).getByRole('button', { name: /^EUR/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ fiatCurrency: 'EUR' }));
        expect(await appearanceHeading()).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('button', { name: /^Fiat currency/ }).textContent).toContain('Euro (EUR)'));
        fireEvent.click(screen.getByRole('button', { name: /^Fiat currency/ }));
        const reopened = await screen.findByRole('list', { name: 'Fiat currencies' });
        await waitFor(() => expect(within(reopened).getByRole('button', { name: /^EUR/ }).getAttribute('aria-current')).toBe('true'));
    });

    it('changes Reduce motion with the compact dropdown, an icon per choice', async () => {
        const { messaging, container } = await openGroup('g-appearance');
        const row = container.querySelector('[data-settings-row-id="appearance-motion"]');
        expect(row.textContent).toContain('Turns off sliding and fading animations');
        const field = within(row).getByRole('combobox', { name: 'Reduce motion' });
        await waitFor(() => expect(field.disabled).toBe(false));
        // Short option names (System, On, Off) so the dropdown fits beside the title on a 360px phone.
        expect(field.textContent).toContain('System');
        // One dropdown, not a row of three buttons.
        expect(within(row).getAllByRole('button').filter((b) => b.getAttribute('role') !== 'combobox')).toHaveLength(1);
        fireEvent.click(field);
        const options = within(await screen.findByRole('listbox')).getAllByRole('option');
        expect(options.map((o) => o.textContent)).toEqual(['System', 'On', 'Off']);
        for (const option of options) expect(option.querySelector('svg')).not.toBeNull();
        fireEvent.click(screen.getByRole('option', { name: 'On' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ reducedMotion: 'always' }));
        await waitFor(() => expect(within(row).getByRole('combobox', { name: 'Reduce motion' }).textContent).toContain('On'));
    });

    it('describes the pin and hide buttons by where they show and what hiding does', async () => {
        const { container } = await openGroup('g-appearance');
        expect(container.querySelector('[data-settings-row-id="display-pin"]').textContent)
            .toContain('Shows a star on token rows to pin a token to the top of Home');
        expect(container.querySelector('[data-settings-row-id="display-hide"]').textContent)
            .toContain('Shows a hide button on token rows; hidden tokens move to the Hidden list in Tokens and fold to the end of Home and pickers');
    });

    // The Hide Small Balances page body is drawn and tested by its own
    // helper's work (HideSmallBalancesPage.jsx); the row, its value, opening
    // and Back are covered by the row table above.

    // Number Format is a Form Standard form (walk 2026-11-15): the sample
    // centred, then the Display format picker field, which opens a picker page.
    describe('Number Format', () => {
        const sample = () => document.querySelector('[data-number-format-sample]')?.textContent;
        const field = () => screen.getByRole('button', { name: /^Display format/ });
        const openPicker = async () => {
            await waitFor(() => expect(field().disabled).toBe(false));
            fireEvent.click(field());
            expect(await screen.findByRole('heading', { level: 1, name: 'Display Format' })).toBeTruthy();
            return screen.findByRole('list', { name: 'Display formats' });
        };

        it('is a live sample over one full-width Display format field: no row icon, no dropdown, no hint line', async () => {
            await openFromAppearance('display-number-format');
            await waitFor(() => expect(sample()).toBe('1,234.56780000'));
            const form = document.querySelector('[data-number-format-form]');
            // The standard picker field shows the chosen format, its option
            // icon at the left and its list icon at the right.
            await waitFor(() => expect(field().getAttribute('aria-label')).toBe('Display format: Full decimals'));
            expect(field().textContent).toContain('Full decimals');
            expect(field().querySelector('[data-list-field-icon] svg')).not.toBeNull();
            expect(field().querySelectorAll('svg')).toHaveLength(2);
            // A field, not a menu row: no settings row, row icon or dropdown.
            expect(form.querySelector('[data-settings-row-id]')).toBeNull();
            expect(form.querySelector('[data-settings-group-icon]')).toBeNull();
            expect(within(form).queryByRole('combobox')).toBeNull();
            // The "Display only" hint line is gone; the formats are explained by
            // the picker rows and the field keeps its ? help tip (U57).
            expect(form.textContent).not.toMatch(/Display only|stored amounts never change/);
            expect(within(form).getByRole('button', { name: 'About Display format' })).toBeTruthy();
            // The sample sits before the field, centred by its card's rule.
            expect(form.firstElementChild.hasAttribute('data-number-format-sample-card')).toBe(true);
        });

        it('centres the sample', () => {
            const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/settings/AppearancePages.module.css'), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '');
            const rule = /(^|[}\s])\.sample\s*\{([^}]*)\}/.exec(css)?.[2] || '';
            expect(rule).toMatch(/align-items:\s*center/);
            expect(rule).toMatch(/text-align:\s*center/);
        });

        it('opens the Display Format picker page from the field; a pick saves, returns and the sample and row follow', async () => {
            const { messaging } = await openFromAppearance('display-number-format');
            await waitFor(() => expect(sample()).toBe('1,234.56780000'));
            let list = await openPicker();
            expectListCard(list);
            // Each format is a row with its icon and the sample in that format; the chosen one is checked.
            const rows = within(list).getAllByRole('button');
            expect(rows.map((r) => r.textContent)).toEqual([
                expect.stringMatching(/^Full decimals.*1,234\.56780000/),
                expect.stringMatching(/^Trim trailing zeros.*1,234\.5678$/),
                expect.stringMatching(/^No separator, full decimals.*1234\.56780000/),
            ]);
            for (const row of rows) expect(row.querySelector('svg')).not.toBeNull();
            expect(rows[0].getAttribute('aria-current')).toBe('true');
            expect(document.querySelectorAll('[data-settings-choice-check]')).toHaveLength(1);
            expect(screen.queryAllByRole('radio')).toHaveLength(0);
            expect(screen.queryByRole('dialog')).toBeNull();
            const trimRow = within(list).getByRole('button', { name: /^Trim trailing zeros/ });
            const trimIcon = trimRow.querySelector('svg').outerHTML;
            fireEvent.click(trimRow);
            await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ numberFormat: 'trim' }));
            // Back on Number Format with the choice applied.
            expect(await screen.findByRole('heading', { level: 1, name: 'Number Format' })).toBeTruthy();
            await waitFor(() => expect(sample()).toBe('1,234.5678'));
            await waitFor(() => expect(field().textContent).toContain('Trim trailing zeros'));
            expect(field().querySelector('[data-list-field-icon] svg').outerHTML).toBe(trimIcon);
            list = await openPicker();
            await waitFor(() => expect(within(list).getByRole('button', { name: /^Trim trailing zeros/ }).getAttribute('aria-current')).toBe('true'));
            fireEvent.click(within(list).getByRole('button', { name: /^No separator/ }));
            await waitFor(() => expect(sample()).toBe('1234.56780000'));
            // Back from the picker returns to Number Format, then Appearance.
            list = await openPicker();
            back();
            expect(await screen.findByRole('heading', { level: 1, name: 'Number Format' })).toBeTruthy();
            back();
            expect(await appearanceHeading()).toBeTruthy();
            await waitFor(() => expect(screen.getByRole('button', { name: /^Number format/ }).textContent).toContain('1234.56780000'));
        });
    });

    it('changes Learn mode and Haptic feedback in place', async () => {
        const { messaging } = await openGroup('g-appearance');
        fireEvent.click(await screen.findByRole('switch', { name: 'Learn mode' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ learnMode: true }));
        fireEvent.click(screen.getByRole('switch', { name: 'Haptic feedback' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { hapticsEnabled: false } }));
    });

    it('clears remembered network filters from a confirm page with one button, then Done returns', async () => {
        localStorage.setItem('xc:chainFilter:history:w1', JSON.stringify(['bitcoin']));
        localStorage.setItem('unrelated', 'stays');
        try {
            const { container } = await openGroup('g-appearance');
            // The row itself carries no button of its own (no inline Reset).
            const li = container.querySelector('[data-settings-row-id="display-lists"]');
            expect(li.querySelectorAll('button')).toHaveLength(1);
            fireEvent.click(rowButton(container, 'display-lists'));
            expect(await screen.findByRole('heading', { level: 1, name: 'Clear Remembered Network Filters' })).toBeTruthy();
            expect(screen.getByText(/History remembers the network you last picked/)).toBeTruthy();
            expect(screen.queryByRole('dialog')).toBeNull();
            const actions = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Back to settings' && !/Back to settings/.test(b.textContent));
            expect(actions.map((b) => b.textContent)).toEqual(['Clear Network Filters']);
            fireEvent.click(screen.getByRole('button', { name: 'Clear Network Filters' }));
            expect(await screen.findByText(/Cleared 1 remembered network filter\./)).toBeTruthy();
            expect(localStorage.getItem('xc:chainFilter:history:w1')).toBeNull();
            expect(localStorage.getItem('unrelated')).toBe('stays');
            fireEvent.click(screen.getByRole('button', { name: 'Done' }));
            expect(await appearanceHeading()).toBeTruthy();
        } finally {
            localStorage.removeItem('unrelated');
        }
    });

    it('resets display settings from a confirm page that lists every change, then Done returns', async () => {
        const initial = createDefaultSettings();
        Object.assign(initial, { theme: 'dark', reducedMotion: 'always', fiatCurrency: 'EUR', numberFormat: 'trim', pinnedTokens: ['bitcoin:BTC'], learnMode: true });
        const messaging = harness(initial);
        const { container } = await openGroup('g-appearance', messaging);
        expect(container.querySelector('[data-settings-row-id="display-reset"]').querySelectorAll('button')).toHaveLength(1);
        fireEvent.click(rowButton(container, 'display-reset'));
        expect(await screen.findByRole('heading', { level: 1, name: 'Reset Display Settings' })).toBeTruthy();
        expect(screen.getByText('Theme: System default. Reduce motion: System.')).toBeTruthy();
        expect(screen.getByText('Language: English. Fiat currency: US Dollar (USD).')).toBeTruthy();
        expect(screen.getByText('Hide small balances and Hide unknown tokens off. Number format: Full decimals.')).toBeTruthy();
        expect(screen.getByText(/empties your watched, pinned and hidden token lists/)).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        const reset = screen.getByRole('button', { name: 'Reset Display Settings' });
        await waitFor(() => expect(reset.disabled).toBe(false));
        fireEvent.click(reset);
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
            theme: 'system',
            reducedMotion: 'auto',
            language: 'en',
            fiatCurrency: 'USD',
            learnMode: false,
            numberFormat: 'full',
            pinnedTokens: [],
            showPinAffordance: false,
            privacy: { hideSmallBalances: false, hapticsEnabled: true },
        })));
        expect(await screen.findByText('Display settings reset to defaults.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(await appearanceHeading()).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('button', { name: /^Theme/ }).textContent).toContain('System default'));
        expect(screen.getByRole('button', { name: /^Fiat currency/ }).textContent).toContain('US Dollar (USD)');
    });
});

describe('Notifications', () => {
    it('greys the event switches until notifications are allowed', async () => {
        const requestPermission = vi.fn(async () => {
            globalThis.Notification.permission = 'granted';
            return 'granted';
        });
        globalThis.Notification = { permission: 'default', requestPermission };
        const { container, messaging } = await openGroup('g-notifications');
        // Nine event switches and the Price alerts master (G08).
        expect(rowLists(container).Events).toHaveLength(10);
        expect(screen.getByRole('switch', { name: 'Price alerts' })).toBeTruthy();
        expect(drillRows(container)).toEqual(['notifications-quiet', 'notifications-sounds', 'notifications-price-alerts']);
        const receipts = await screen.findByRole('switch', { name: 'Incoming receipts' });
        expect(receipts.disabled).toBe(true);
        expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
        fireEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
        await waitFor(() => expect(requestPermission).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Incoming receipts' }).disabled).toBe(false));
        const before = screen.getByRole('switch', { name: 'Incoming receipts' }).checked;
        fireEvent.click(screen.getByRole('switch', { name: 'Incoming receipts' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ notifications: { incomingReceipts: !before } }));
    });
});

describe('old Settings pages land on the row that took over', () => {
    it.each([
        ['security-autolock', 'Security', 'security-autolock'],
        ['security-lookalike', 'Security', 'security-lookalike'],
        ['privacy-hardware', 'Security', 'privacy-hardware'],
        ['backup-contacts', 'Backup and Recovery', 'backup-contacts-export'],
        ['privacy-labels', 'Backup and Recovery', 'privacy-labels'],
        ['display-rows', 'Appearance', 'display-pin'],
        ['appearance-motion', 'Appearance', 'appearance-motion'],
        ['privacy-haptics', 'Appearance', 'privacy-haptics'],
        ['advanced-developer', 'Advanced', 'advanced-developer'],
    ])('%s opens %s at its row', async (id, title, rowId) => {
        renderSettings(harness(), { initialSubpageId: id });
        expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
        await waitFor(() => expect(document.querySelector('[data-settings-search-highlight="true"]')?.getAttribute('data-settings-row-id')).toBe(rowId));
    });

    it.each([
        ['safety', 'Security'],
        ['appearance', 'Appearance'],
        ['display', 'Appearance'],
        ['language-region', 'Appearance'],
        ['display-watched', 'Tokens'],
        ['developer', 'Developer Options'],
        // Network has a page of its own again (2026-11-14).
        ['network', 'Network'],
        ['network-active', 'Network'],
        // Panic mode opens its own page (operator ruling 2026-11-14).
        ['security-panic', 'Panic Mode'],
        ['security-biometric-enable', 'Enable Biometric Unlock'],
        // The Appearance value and confirm rows open pages (operator rulings 2026-11-14).
        ['appearance-theme', 'Theme'],
        ['appearance-language', 'Language'],
        ['appearance-currency', 'Fiat Currency'],
        ['display-balances', 'Hide Small Balances'],
        ['display-number-format', 'Number Format'],
        ['display-lists', 'Clear Remembered Network Filters'],
        ['display-reset', 'Reset Display Settings'],
    ])('%s opens %s', async (id, title) => {
        renderSettings(harness(), { initialSubpageId: id });
        expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
    });
});
