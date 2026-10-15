// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings;
let update;
let priceAlerts;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => priceAlerts,
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: {} }),
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

function alertRecord(overrides = {}) {
    return {
        id: 'alert-1',
        chainId: 'bitcoin-mainnet',
        direction: 'above',
        targetFiat: 70000,
        fiatCurrency: 'usd',
        status: 'armed',
        ...overrides,
    };
}

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn().mockResolvedValue(settings);
    priceAlerts = {
        alerts: [],
        loading: false,
        supported: true,
        error: null,
        addAlert: vi.fn().mockResolvedValue(undefined),
        updateAlert: vi.fn().mockResolvedValue(undefined),
        removeAlert: vi.fn().mockResolvedValue(undefined),
        rearm: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('notification categories and permission', () => {
    it('requests and revokes the optional Chrome notification permission', async () => {
        const prior = globalThis.chrome;
        const contains = vi.fn(async () => false);
        const request = vi.fn(async () => true);
        const remove = vi.fn(async () => true);
        globalThis.chrome = { permissions: { contains, request, remove } };
        try {
            render(<NotificationsSection />);

            expect(await screen.findByRole('button', { name: 'Allow notifications' })).toBeTruthy();
            expect(screen.getByText(/Optional\. Allows XChain Wallet/)).toHaveTextContent(
                'You can revoke access here at any time.',
            );
            const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
            expect(category).not.toBeChecked();
            expect(category).toBeDisabled();
            expect(request).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));

            await waitFor(() => expect(request).toHaveBeenCalledWith({ permissions: ['notifications'] }));
            await waitFor(() => expect(category).toBeChecked());
            expect(category).toBeEnabled();
            fireEvent.click(await screen.findByRole('button', { name: 'Revoke permission' }));

            await waitFor(() => expect(remove).toHaveBeenCalledWith({ permissions: ['notifications'] }));
            expect(await screen.findByRole('button', { name: 'Allow notifications' })).toBeTruthy();
            expect(category).not.toBeChecked();
            expect(category).toBeDisabled();
        } finally {
            globalThis.chrome = prior;
        }
    });

    it('reflects an extension permission removed outside the settings row', async () => {
        const prior = globalThis.chrome;
        let granted = true;
        const removedListeners = new Set();
        const request = vi.fn(async () => true);
        globalThis.chrome = {
            permissions: {
                contains: vi.fn(async () => granted),
                request,
                remove: vi.fn(async () => true),
                onRemoved: {
                    addListener: vi.fn((listener) => removedListeners.add(listener)),
                    removeListener: vi.fn((listener) => removedListeners.delete(listener)),
                },
            },
        };
        try {
            render(<NotificationsSection />);
            expect(await screen.findByRole('button', { name: 'Revoke permission' })).toBeTruthy();
            const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
            expect(category).toBeChecked();

            granted = false;
            for (const listener of removedListeners) listener({ permissions: ['notifications'] });

            expect(await screen.findByRole('button', { name: 'Allow notifications' })).toBeTruthy();
            expect(category).not.toBeChecked();
            expect(category).toBeDisabled();
            expect(request).not.toHaveBeenCalled();
        } finally {
            globalThis.chrome = prior;
        }
    });

    it('explains that denied permission must be allowed in browser or system settings', () => {
        const prior = globalThis.Notification;
        globalThis.Notification = { permission: 'denied', requestPermission: vi.fn() };
        try {
            render(<NotificationsSection />);
            expect(screen.getByText(/Notifications are blocked/)).toHaveTextContent(
                'Open your browser or system settings, find XChain Wallet, and allow notifications.',
            );
            expect(screen.queryByRole('button', { name: 'Request permission' })).toBeNull();
            const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
            expect(category).not.toBeChecked();
            expect(category).toBeDisabled();
            expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
        } finally {
            globalThis.Notification = prior;
        }
    });

    it('refreshes the effective toggle state when web permission is revoked', async () => {
        const prior = globalThis.Notification;
        const requestPermission = vi.fn();
        globalThis.Notification = { permission: 'granted', requestPermission };
        try {
            render(<NotificationsSection />);
            const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
            expect(category).toBeChecked();
            expect(category).toBeEnabled();

            globalThis.Notification.permission = 'denied';
            fireEvent.focus(window);

            await waitFor(() => expect(category).not.toBeChecked());
            expect(category).toBeDisabled();
            expect(screen.getByText(/Notifications are blocked/)).toBeTruthy();
            expect(requestPermission).not.toHaveBeenCalled();
        } finally {
            globalThis.Notification = prior;
        }
    });

    it('writes a category toggle and reports a rejected update', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        update.mockRejectedValueOnce(new Error('storage failed'));
        render(<NotificationsSection />);

        fireEvent.click(screen.getByRole('switch', { name: 'Transaction confirmations' }));

        expect(update).toHaveBeenCalledWith({ notifications: { txConfirmations: false } });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not update transaction confirmations. Try again.',
        );
        expect(consoleError).toHaveBeenCalled();
    });
});

describe('price alert manager', () => {
    it('keeps and labels an alert in its original currency after a display-currency switch', async () => {
        settings = { ...settings, fiatCurrency: 'EUR' };
        priceAlerts.alerts = [alertRecord({ fiatCurrency: 'usd' })];
        render(<NotificationsSection walletId="wallet-1" />);

        const edit = screen.getByRole('button', { name: 'Edit Bitcoin price alert' });
        expect(edit.closest('div')).toHaveTextContent('Bitcoin rises above $70,000');
        expect(screen.getByText(/Saved price alerts keep the currency/)).toHaveTextContent(
            'Delete and recreate an alert to use the current display currency.',
        );
        fireEvent.click(edit);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(priceAlerts.updateAlert).toHaveBeenCalledWith('alert-1', {
            chainId: 'bitcoin-mainnet',
            direction: 'above',
            targetFiat: 70000,
            fiatCurrency: 'usd',
        }));
    });

    it('distinguishes loading from an empty result', () => {
        priceAlerts.loading = true;
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.getByText('Loading price alerts…')).toBeTruthy();
        expect(screen.queryByText(/No price alerts yet/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Add alert' })).toBeNull();
    });

    it('offers a retry after the alert list fails to load', () => {
        priceAlerts.error = 'storage failed';
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load price alerts.');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(priceAlerts.reload).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/No price alerts yet/)).toBeNull();
    });

    it('says one thing, not two, while price alerts are switched off', () => {
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.getByText('Turn on Price alerts above to start receiving these.')).toBeTruthy();
        expect(screen.queryByText('No price alerts yet')).toBeNull();
    });

    it('creates a price alert from the empty state', async () => {
        settings.notifications.priceAlerts = true;
        render(<NotificationsSection walletId="wallet-1" />);
        expect(screen.getAllByRole('status').some(
            (region) => region.textContent === 'No price alerts yetAdd one below.',
        )).toBe(true);

        fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '71000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));

        await waitFor(() => expect(priceAlerts.addAlert).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            direction: 'above',
            targetFiat: 71000,
            fiatCurrency: 'usd',
        }));
    });

    it('edits an existing price alert', async () => {
        priceAlerts.alerts = [alertRecord()];
        render(<NotificationsSection walletId="wallet-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Bitcoin price alert' }));
        expect(screen.getByLabelText('Target price').value).toBe('70000');
        fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'below' } });
        fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '65000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(priceAlerts.updateAlert).toHaveBeenCalledWith('alert-1', {
            chainId: 'bitcoin-mainnet',
            direction: 'below',
            targetFiat: 65000,
            fiatCurrency: 'usd',
        }));
    });

    it('shows when a price alert triggered with its exact local time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jan 15, 2026, 3:58 AM PST');
        priceAlerts.alerts = [alertRecord({
            status: 'triggered',
            triggeredAt: '2026-01-15T11:58:00.000Z',
        })];

        render(<NotificationsSection walletId="wallet-1" />);

        const time = screen.getByText('2 minutes ago');
        expect(time).toHaveAttribute('title', 'Jan 15, 2026, 3:58 AM PST');
    });

    it('deletes an alert', async () => {
        priceAlerts.alerts = [alertRecord()];
        render(<NotificationsSection walletId="wallet-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Bitcoin price alert' }));

        await waitFor(() => expect(priceAlerts.removeAlert).toHaveBeenCalledWith('alert-1'));
        expect(screen.queryByText('Could not update the price alert. Try again.')).toBeNull();
    });

    it('reports deletion failures', async () => {
        priceAlerts.alerts = [alertRecord()];
        priceAlerts.removeAlert.mockRejectedValueOnce(new Error('delete failed'));
        render(<NotificationsSection walletId="wallet-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Bitcoin price alert' }));

        expect(priceAlerts.removeAlert).toHaveBeenCalledWith('alert-1');
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not update the price alert. Try again.',
        );
    });
});
