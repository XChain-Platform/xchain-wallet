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
        fireEvent.click(disconnect);

        expect(messaging.deleteConnectedSite).toHaveBeenCalledTimes(1);
        expect(disconnect).toBeDisabled();
        finishDelete();
        await waitFor(() => expect(messaging.listConnectedSites).toHaveBeenCalledTimes(2));
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
