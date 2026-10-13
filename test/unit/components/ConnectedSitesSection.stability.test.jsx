// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import {
    SIGN_THROTTLE_DEFAULT_BURST,
    SIGN_THROTTLE_DEFAULT_WINDOW_MS,
} from '../../../packages/core/src/flows/signThrottle.js';

let messaging;
let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

const { ConnectedSitesSection } = await import(
    '../../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx'
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
        blockOrigin: vi.fn(),
        unblockOrigin: vi.fn(),
    };
});

afterEach(() => cleanup());

describe('ConnectedSitesSection settings controls', () => {
    it('marks destructive site actions as danger and disables repeat disconnects', async () => {
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
        const disconnect = await screen.findByRole('button', { name: 'Disconnect' });
        const block = screen.getAllByRole('button', { name: 'Block' }).find((button) => !button.disabled);
        expect(disconnect.className).toMatch(/danger/);
        expect(block.className).toMatch(/danger/);

        fireEvent.click(disconnect);
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect site' }));
        await waitFor(() => expect(messaging.deleteConnectedSite).toHaveBeenCalledTimes(1));
        fireEvent.click(disconnect);

        expect(messaging.deleteConnectedSite).toHaveBeenCalledTimes(1);
        expect(disconnect).toBeDisabled();
        finishDelete();
        await waitFor(() => expect(messaging.listConnectedSites).toHaveBeenCalledTimes(2));
    });

    it('shows a structured empty state after connected sites load', async () => {
        render(<ConnectedSitesSection />);

        expect(await screen.findByText('No sites connected yet')).toBeTruthy();
        expect(screen.getByText(/When a website asks to connect/)).toBeTruthy();
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

        const permissionsButton = await screen.findByRole('button', { name: 'Permissions' });
        expect(permissionsButton.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(permissionsButton);
        expect(screen.getByRole('button', { name: 'Hide' }).getAttribute('aria-expanded')).toBe('true');
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
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
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

    it('requires confirmation before blocking a connected origin', async () => {
        messaging.listConnectedSites = vi.fn(async () => [{
            id: 'site-1',
            origin: 'https://dapp.example',
            appName: 'Example dApp',
            permissions: {},
        }]);
        render(<ConnectedSitesSection />);

        const block = (await screen.findAllByRole('button', { name: 'Block' }))[0];
        expect(block.className).toMatch(/danger/);
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

    it('uses a confirmed danger action to clear the blocklist audit log', async () => {
        messaging.listBlocklistAuditLog = vi.fn(async () => ([{
            at: Date.now(),
            action: 'add',
            entry: 'https://blocked.example',
        }]));
        messaging.clearBlocklistAuditLog = vi.fn(async () => {});
        render(<ConnectedSitesSection />);

        const clear = await screen.findByRole('button', { name: 'Clear history' });
        expect(clear.className).toMatch(/danger/);
        fireEvent.click(clear);

        expect(messaging.clearBlocklistAuditLog).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Clear site block history?' })).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: 'Clear history' }).at(-1));

        await waitFor(() => expect(messaging.clearBlocklistAuditLog).toHaveBeenCalledTimes(1));
    });

    it('writes effective defaults when both throttle fields are cleared', async () => {
        render(<ConnectedSitesSection />);
        const burst = await screen.findByRole('spinbutton', { name: 'Sign-throttle burst (max requests per window)' });
        const windowSeconds = screen.getByRole('spinbutton', { name: 'Sign-throttle window in seconds' });
        expect(burst.className).toMatch(/input/);
        fireEvent.change(burst, { target: { value: '' } });
        fireEvent.change(windowSeconds, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(() => expect(update).toHaveBeenCalledWith({
            signThrottle: {
                burst: SIGN_THROTTLE_DEFAULT_BURST,
                windowMs: SIGN_THROTTLE_DEFAULT_WINDOW_MS,
            },
        }));
    });

    it('rejects fractional throttle values instead of rounding them', async () => {
        render(<ConnectedSitesSection />);
        const burst = await screen.findByRole('spinbutton', { name: 'Sign-throttle burst (max requests per window)' });
        fireEvent.change(burst, { target: { value: '2.5' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Sign-request throttle controls' }));

        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText(/Burst must be an integer/)).toBeTruthy();
    });

    it('preserves millisecond throttle windows represented as fractional seconds', async () => {
        settings.signThrottle.windowMs = 1001;
        render(<ConnectedSitesSection />);

        const windowSeconds = await screen.findByRole('spinbutton', { name: 'Sign-throttle window in seconds' });
        expect(windowSeconds.value).toBe('1.001');
        fireEvent.submit(screen.getByRole('form', { name: 'Sign-request throttle controls' }));

        await waitFor(() => expect(update).toHaveBeenCalledWith({
            signThrottle: {
                burst: 20,
                windowMs: 1001,
            },
        }));
    });

    it('lets the page own scrolling for the audit log', async () => {
        messaging.listBlocklistAuditLog = vi.fn(async () => ([{
            at: Date.now(),
            action: 'add',
            entry: 'https://blocked.example',
        }]));
        messaging.clearBlocklistAuditLog = vi.fn();
        render(<ConnectedSitesSection />);

        const entry = await screen.findByText('https://blocked.example');
        const list = screen.getByRole('list');
        expect(list).toContainElement(entry);
        expect(list.style.overflowY).toBe('');
        expect(list.style.maxHeight).toBe('');
    });
});
