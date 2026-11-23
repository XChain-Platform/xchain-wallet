// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { selectOption } from '../../helpers/selectOption.js';

let messaging;
let settings;
let update;
const biometric = vi.hoisted(() => ({
    registered: false,
    describe: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
// One shared spy, so a test can read back the toasts the page raised.
const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: toast.show }),
}));
vi.mock('../../../packages/core/src/flows/biometricUnlock.js', () => ({
    describeBiometric: biometric.describe,
    isBiometricRegistered: () => biometric.registered,
    registerBiometricCredential: vi.fn(),
    clearBiometricCredential: vi.fn(),
}));

const { ConnectedSitesSection } = await import(
    '../../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx'
);
const { ContactsSection } = await import(
    '../../../packages/core/src/shared/components/settings/ContactsSection.jsx'
);
const { BiometricRow } = await import(
    '../../../packages/core/src/shared/components/settings/BiometricRow.jsx'
);

beforeEach(() => {
    settings = {
        ...createDefaultSettings(),
        signThrottle: { burst: 20, windowMs: 120000 },
    };
    update = vi.fn(async () => settings);
    messaging = {
        listConnectedSites: vi.fn(async () => []),
        listBlockedOrigins: vi.fn(async () => []),
        listBlocklistAuditLog: vi.fn(async () => []),
        blockOrigin: vi.fn(),
        unblockOrigin: vi.fn(),
    };
    biometric.registered = false;
    biometric.describe.mockReset().mockResolvedValue({
        supported: true,
        reason: null,
        mechanism: 'device unlock',
        wrapNote: 'The password stays protected.',
    });
});

afterEach(() => cleanup());

// The page opens on Allowed; Options and Blocked are the other two
// segments of the toggle, and a site's actions live on its detail.
async function showView(name) {
    fireEvent.click(await screen.findByRole('radio', { name }));
}
async function openSite(name) {
    fireEvent.click((await screen.findByText(name)).closest('button'));
}
async function openBlockForm() {
    fireEvent.click(await screen.findByRole('button', { name: 'Block a site' }));
}

describe('ConnectedSitesSection settings controls', () => {
    it('uses the standard plus action in the list header', () => {
        const source = readFileSync('packages/core/src/shared/components/settings/ConnectedSitesSection.jsx', 'utf8');
        expect(source).toMatch(/icon=\{<Icon\.PlusIcon \/>\}[\s\S]*blockASite/);
        expect(source).not.toMatch(/icon=\{<Icon\.BanIcon \/>\}[\s\S]*blockASite/);
    });

    it('makes each form submit a named green action with an icon and tips every field', async () => {
        render(<ConnectedSitesSection />);

        await showView('Options');
        // The throttle rows apply at once, so Options has no submit button.
        await screen.findByTestId('throttle-select-burst');
        expect(screen.queryByRole('button', { name: /apply|save/i })).toBeNull();
        // Requests per site and Window each carry their own '?' tip, and the
        // Custom window field (open, since 120 s is not a preset) carries one too.
        expect(screen.getAllByRole('button', { name: /^About / }).map((b) => b.getAttribute('aria-label') || b.textContent))
            .toHaveLength(3);
        expect(screen.getByRole('button', { name: /^About Requests per site/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^About Window/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^About Custom window/ })).toBeTruthy();

        await openBlockForm();
        const blockSite = await screen.findByRole('button', { name: 'Block Site' });
        expect(blockSite.className).toMatch(/success/);
        expect(blockSite.querySelector('svg')).not.toBeNull();
        expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(1);
    });

    it('names the manual block form apart from its origin field', async () => {
        render(<ConnectedSitesSection />);
        await openBlockForm();
        const origin = await screen.findByRole('textbox', { name: 'Origin or wildcard to block' });

        // One label, one control: the form carries its own name, so a label
        // lookup for the field never also finds the form around it.
        expect(screen.getAllByLabelText('Origin or wildcard to block')).toEqual([origin]);
        expect(screen.getByRole('form', { name: 'Block site' })).toBe(origin.closest('form'));
    });

    it('keeps the throttle description compact', async () => {
        render(<ConnectedSitesSection />);
        await showView('Options');

        expect(await screen.findByText(/Requests past the limit are rejected/)).toBeTruthy();
        expect(screen.queryByText(/Blocked sites cannot connect/)).toBeNull();
    });

    it('ignores a connected-site load from a replaced messaging source', async () => {
        let resolveOld;
        const oldMessaging = messaging;
        oldMessaging.listConnectedSites = vi.fn(() => new Promise((resolve) => { resolveOld = resolve; }));
        const { rerender } = render(<ConnectedSitesSection />);

        messaging = {
            ...oldMessaging,
            listConnectedSites: vi.fn(async () => [{
                id: 'new-site',
                origin: 'https://new.example',
                permissions: {},
            }]),
        };
        rerender(<ConnectedSitesSection />);

        expect(await screen.findAllByText('https://new.example')).toHaveLength(1);
        resolveOld([{
            id: 'old-site',
            origin: 'https://old.example',
            permissions: {},
        }]);
        await Promise.resolve();
        await Promise.resolve();

        expect(screen.getAllByText('https://new.example')).toHaveLength(1);
        expect(screen.queryAllByText('https://old.example')).toHaveLength(0);
    });

    it('shows the origin under a named site but never repeats an origin title', async () => {
        messaging = {
            ...messaging,
            listConnectedSites: vi.fn(async () => [
                { id: 'named', origin: 'https://named.example', appName: 'Named App', permissions: {} },
                { id: 'bare', origin: 'https://bare.example', permissions: {} },
            ]),
        };
        render(<ConnectedSitesSection />);

        expect(await screen.findByText('Named App')).toBeInTheDocument();
        expect(screen.getAllByText('https://named.example')).toHaveLength(1);
        expect(screen.getAllByText('https://bare.example')).toHaveLength(1);
    });

    it('shows no block history and never reads the audit log', async () => {
        messaging.listBlocklistAuditLog = vi.fn(async () => [{
            at: Date.now(),
            action: 'add',
            entry: 'https://history.example',
        }]);
        messaging.clearBlocklistAuditLog = vi.fn();
        render(<ConnectedSitesSection />);

        for (const view of ['Allowed', 'Blocked', 'Options']) {
            await showView(view);
            expect(screen.queryByText(/block history/i)).toBeNull();
            expect(screen.queryByRole('button', { name: 'Clear History' })).toBeNull();
            expect(screen.queryByText('https://history.example')).toBeNull();
        }
        expect(messaging.listBlocklistAuditLog).not.toHaveBeenCalled();
        expect(messaging.clearBlocklistAuditLog).not.toHaveBeenCalled();
    });

    it('uses standard action rows and disables repeat disconnects', async () => {
        let finishDelete;
        messaging.listConnectedSites.mockResolvedValue([{
            id: 'site-1',
            origin: 'https://wallet.example',
            appName: 'Wallet example',
            permissions: {},
        }]);
        messaging.deleteConnectedSite = vi.fn(() => new Promise((resolve) => { finishDelete = resolve; }));
        messaging.restoreConnectedSite = vi.fn();

        render(<ConnectedSitesSection />);
        await openSite('Wallet example');
        const disconnect = await screen.findByRole('button', { name: 'Disconnect' });
        const block = screen.getByRole('button', { name: 'Block Site' });
        const actions = screen.getByRole('list', { name: 'Site actions' });
        expect(actions).toContainElement(disconnect);
        expect(actions).toContainElement(block);
        expect(disconnect).toHaveAttribute('data-tone', 'default');
        expect(block).toHaveAttribute('data-tone', 'default');

        fireEvent.click(disconnect);
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect site' }));
        await waitFor(() => expect(messaging.deleteConnectedSite).toHaveBeenCalledTimes(1));
        fireEvent.click(disconnect);

        expect(messaging.deleteConnectedSite).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveAttribute('aria-disabled', 'true');
        finishDelete();
        await waitFor(() => expect(messaging.listConnectedSites).toHaveBeenCalledTimes(2));
    });

    it('shows a structured empty state after connected sites load', async () => {
        render(<ConnectedSitesSection />);

        expect(await screen.findByText('No sites connected yet')).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Connected sites and dApp permissions' })).toBeTruthy();
        // The page header reads Connected Sites; the empty list adds no heading of its own.
        expect(screen.getByRole('heading', { name: 'Connected Sites' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Connected sites' })).toBeNull();
        expect(screen.getByText(/When a website asks to connect/)).toBeTruthy();
    });

    it('renders all connected-site empty lines as plain text', async () => {
        render(<ConnectedSitesSection />);

        const emptyLines = [await screen.findByText('No sites connected yet')];
        await showView('Blocked');
        emptyLines.push(await screen.findByText('No blocked sites'));
        for (const line of emptyLines) {
            expect(line.closest('[role="status"]')).toBeTruthy();
            expect(line.closest('[class*="card"]')).toBeNull();
        }
    });

    it('keeps the seven settings sections on the shared form template', () => {
        const files = [
            'ConnectedSitesSection.jsx',
            'BackupSection.jsx',
            'ThisWalletSection.jsx',
            'DeveloperModeSection.jsx',
            'DisplaySection.jsx',
            'BiometricRow.jsx',
            'DuressPassphraseRow.jsx',
        ];
        for (const file of files) {
            const source = readFileSync(`packages/core/src/shared/components/settings/${file}`, 'utf8');
            expect(source, file).not.toMatch(/<\/?form\b/);
            expect(source, file).toMatch(/<FormPage\b/);
        }
    });

    it('displays each site permission using the bridge policy semantics', async () => {
        messaging.listConnectedSites = vi.fn(async () => [{
            id: 'site-1',
            origin: 'https://dapp.example',
            appName: 'Example dApp',
            permissions: {
                chains: ['bitcoin', 'litecoin'],
                accounts: ['account-1'],
                canSignMessage: false,
                canSignAction: {
                    SEND: 'always',
                    SWEEP: 'never',
                },
            },
        }]);
        render(<ConnectedSitesSection />);

        await openSite('Example dApp');
        const permissions = await screen.findByRole('list', { name: 'Permissions' });
        // Label-left rows: each fact's label leads its row.
        expect(permissions).toHaveTextContent('Networks');
        expect(permissions).toHaveTextContent('Accounts');
        expect(permissions).toHaveTextContent('Sign messages');
        // The wallet has no call that edits a site's permissions, so the
        // rows read only: no toggle or dropdown is offered.
        expect(permissions.querySelector('input, select, [role="switch"], [role="combobox"]')).toBeNull();
        expect(screen.getByText('bitcoin, litecoin')).toBeTruthy();
        expect(screen.getByText('account-1')).toBeTruthy();
        expect(screen.getByText('Ask every time')).toBeTruthy();
        expect(screen.getByText('Always allow').style.color).toBe('var(--xc-success, #2a8)');
        expect(screen.getByText('Never allow').style.color).toBe('var(--xc-danger-fg)');
    });

    it('ignores an obsolete permission load when the messaging client changes', async () => {
        let resolveObsolete;
        const obsoleteMessaging = {
            ...messaging,
            listConnectedSites: vi.fn(() => new Promise((resolve) => { resolveObsolete = resolve; })),
            deleteConnectedSite: vi.fn(async () => {}),
        };
        messaging = obsoleteMessaging;
        const view = render(<ConnectedSitesSection />);

        const currentMessaging = {
            ...messaging,
            listConnectedSites: vi.fn(async () => [{
                id: 'current-site',
                origin: 'https://current.example',
                appName: 'Current site',
                permissions: { chains: ['bitcoin'], accounts: [], canSignMessage: false, canSignAction: {} },
            }]),
            deleteConnectedSite: vi.fn(async () => {}),
        };
        messaging = currentMessaging;
        view.rerender(<ConnectedSitesSection />);

        expect(await screen.findByText('Current site')).toBeTruthy();
        await act(async () => {
            resolveObsolete([{
                id: 'obsolete-site',
                origin: 'https://obsolete.example',
                appName: 'Obsolete site',
                permissions: { chains: ['litecoin'], accounts: [], canSignMessage: false, canSignAction: {} },
            }]);
            await Promise.resolve();
        });

        expect(screen.queryByText('Obsolete site')).toBeNull();
        await openSite('Current site');
        fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect site' }));

        await waitFor(() => expect(currentMessaging.deleteConnectedSite).toHaveBeenCalledWith({
            id: 'current-site',
        }));
        expect(obsoleteMessaging.deleteConnectedSite).not.toHaveBeenCalled();
    });

    it('requires confirmation before disconnecting a site', async () => {
        const site = {
            id: 'site-1',
            origin: 'https://dapp.example',
            appName: 'Example dApp',
            permissions: {
                chains: [],
                accounts: [],
                canSignMessage: false,
                canSignAction: {},
            },
        };
        let connected = [site];
        messaging.listConnectedSites = vi.fn(async () => connected);
        messaging.deleteConnectedSite = vi.fn(async ({ id }) => {
            connected = connected.filter((entry) => entry.id !== id);
        });
        render(<ConnectedSitesSection />);

        await openSite('Example dApp');
        fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
        expect(messaging.deleteConnectedSite).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog', { name: 'Disconnect Example dApp?' });
        expect(dialog).toHaveTextContent('https://dapp.example will lose access to the accounts you shared and will no longer be able to ask for signatures. You can reconnect the site later.');
        expect(screen.getByRole('button', { name: 'Disconnect site' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(messaging.deleteConnectedSite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect site' }));

        await waitFor(() => expect(messaging.deleteConnectedSite).toHaveBeenCalledWith({ id: 'site-1' }));
        expect(await screen.findByText('No sites connected yet')).toBeTruthy();
    });

    it('explains a refused Undo at the top of the page and keeps the page usable', async () => {
        const site = { id: 'site-1', origin: 'https://dapp.example', appName: 'Example dApp', permissions: {} };
        const blockedErr = Object.assign(new Error('sites.restore: origin is blocked'), { code: 'BLOCKED_BY_USER' });
        for (const [refusal, text] of [
            [blockedErr, "Couldn't reconnect this site because it's blocked. Unblock it before reconnecting."],
            [new Error('sites.restore: site.id is required'), "Couldn't save this change on this device. Try again."],
        ]) {
            toast.show.mockClear();
            let connected = [site];
            messaging.listConnectedSites = vi.fn(async () => connected);
            messaging.deleteConnectedSite = vi.fn(async () => { connected = []; });
            messaging.restoreConnectedSite = vi.fn(async () => { throw refusal; });
            render(<ConnectedSitesSection />);
            await openSite('Example dApp');
            fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
            fireEvent.click(screen.getByRole('button', { name: 'Disconnect site' }));
            await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
            await act(async () => { await toast.show.mock.calls[0][0].onAction(); });

            expect(messaging.restoreConnectedSite).toHaveBeenCalledWith({ site });
            expect(toast.show).toHaveBeenCalledTimes(1);
            const notice = await screen.findByText(text);
            const list = await screen.findByText('No sites connected yet');
            expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
                'the refusal notice sits above the page content').toBeTruthy();
            expect(document.body.textContent).not.toMatch(/Connected sites unavailable|sites\.restore/);
            cleanup();
        }
    });

    it('requires confirmation before blocking a connected origin', async () => {
        messaging.listConnectedSites = vi.fn(async () => [{
            id: 'site-1',
            origin: 'https://dapp.example',
            appName: 'Example dApp',
            permissions: {},
        }]);
        render(<ConnectedSitesSection />);

        await openSite('Example dApp');
        const block = await screen.findByRole('button', { name: 'Block Site' });
        expect(block).toHaveAttribute('data-tone', 'default');
        fireEvent.click(block);

        expect(messaging.blockOrigin).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Block https://dapp.example?' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(messaging.blockOrigin).not.toHaveBeenCalled();

        fireEvent.click(block);
        fireEvent.click(screen.getByRole('button', { name: 'Block site' }));
        await waitFor(() => expect(messaging.blockOrigin).toHaveBeenCalledWith({
            origin: 'https://dapp.example',
        }));
    });

    it('writes a preset choice at once with the other field kept', async () => {
        render(<ConnectedSitesSection />);
        await showView('Options');
        selectOption(await screen.findByTestId('throttle-select-burst'), '5');

        await waitFor(() => expect(update).toHaveBeenCalledWith({
            signThrottle: { burst: 5, windowMs: 120000 },
        }));
    });

    it('rejects fractional throttle requests instead of rounding them', async () => {
        render(<ConnectedSitesSection />);
        await showView('Options');
        selectOption(await screen.findByTestId('throttle-select-burst'), 'custom');
        const burst = await screen.findByTestId('throttle-custom-burst');
        fireEvent.change(burst, { target: { value: '2.5' } });
        fireEvent.blur(burst);

        expect(update).not.toHaveBeenCalled();
        expect(await screen.findByText('Enter a whole number from 1 to 1,000.')).toBeTruthy();
    });

    it('preserves millisecond throttle windows represented as fractional seconds', async () => {
        settings.signThrottle.windowMs = 1001;
        render(<ConnectedSitesSection />);
        await showView('Options');

        const windowSeconds = await screen.findByTestId('throttle-custom-windowMs');
        expect(windowSeconds.value).toBe('1.001');
        fireEvent.change(windowSeconds, { target: { value: '1.002' } });
        fireEvent.blur(windowSeconds);

        await waitFor(() => expect(update).toHaveBeenCalledWith({
            signThrottle: { burst: 20, windowMs: 1002 },
        }));
    });

    it('lets the page own scrolling for the blocked list', async () => {
        messaging.listBlockedOrigins.mockResolvedValue(['https://blocked.example']);
        render(<ConnectedSitesSection />);
        await showView('Blocked');

        const entry = await screen.findByText('https://blocked.example');
        const list = screen.getByRole('list', { name: 'Blocked sites' });
        expect(list).toContainElement(entry);
        expect(list.style.overflowY).toBe('');
        expect(list.style.maxHeight).toBe('');
    });
});

describe('settings async probes', () => {
    it('ignores a contact count from a replaced messaging source', async () => {
        let resolveOld;
        const oldMessaging = {
            listContacts: vi.fn(() => new Promise((resolve) => { resolveOld = resolve; })),
        };
        messaging = oldMessaging;
        const { rerender } = render(<ContactsSection />);

        messaging = {
            listContacts: vi.fn(async () => [{ id: 'new-1' }, { id: 'new-2' }]),
        };
        rerender(<ContactsSection />);

        expect(await screen.findByText('2 contacts stored')).toBeTruthy();
        resolveOld([{ id: 'old-1' }]);
        await Promise.resolve();
        await Promise.resolve();

        expect(screen.getByText('2 contacts stored')).toBeTruthy();
        expect(screen.queryByText('1 contact stored')).toBeNull();
    });

    it('handles a rejected biometric capability probe', async () => {
        biometric.describe.mockRejectedValueOnce(new Error('provider failed'));
        render(<BiometricRow />);

        expect(await screen.findByText(
            'Not available. Could not check biometric unlock on this device.',
        )).toBeTruthy();
    });
});
