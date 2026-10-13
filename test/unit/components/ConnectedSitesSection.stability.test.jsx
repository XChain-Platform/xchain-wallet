// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1));
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
        expect(screen.getByText('ask every time')).toBeTruthy();
        expect(screen.getByText('always allow').style.color).toBe('var(--xc-success, #2a8)');
        expect(screen.getByText('never allow').style.color).toBe('var(--xc-danger-fg)');
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
        expect(screen.getByRole('dialog', { name: 'Disconnect Example dApp?' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(messaging.deleteConnectedSite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1));

        await waitFor(() => expect(messaging.deleteConnectedSite).toHaveBeenCalledWith({ id: 'site-1' }));
        expect(await screen.findByText('No sites connected yet')).toBeTruthy();
    });

    it('writes effective defaults when both throttle fields are cleared', async () => {
        render(<ConnectedSitesSection />);
        const burst = await screen.findByLabelText('Sign-throttle burst (max requests per window)');
        const windowSeconds = screen.getByLabelText('Sign-throttle window in seconds');
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
        const burst = await screen.findByLabelText('Sign-throttle burst (max requests per window)');
        fireEvent.change(burst, { target: { value: '2.5' } });
        fireEvent.submit(burst.closest('form'));

        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText(/Burst must be an integer/)).toBeTruthy();
    });

    it('preserves millisecond throttle windows represented as fractional seconds', async () => {
        settings.signThrottle.windowMs = 1001;
        render(<ConnectedSitesSection />);

        const windowSeconds = await screen.findByLabelText('Sign-throttle window in seconds');
        expect(windowSeconds.value).toBe('1.001');
        fireEvent.submit(windowSeconds.closest('form'));

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
        const list = entry.closest('ul');
        expect(list.style.overflowY).toBe('');
        expect(list.style.maxHeight).toBe('');
    });
});
