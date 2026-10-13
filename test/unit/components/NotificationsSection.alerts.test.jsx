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
    it('explains that denied permission must be allowed in browser or system settings', () => {
        const prior = globalThis.Notification;
        globalThis.Notification = { permission: 'denied', requestPermission: vi.fn() };
        try {
            render(<NotificationsSection />);
            expect(screen.getByText(/Notifications are blocked/)).toHaveTextContent(
                'Open your browser or system settings, find XChain Wallet, and allow notifications.',
            );
            expect(screen.queryByRole('button', { name: 'Request permission' })).toBeNull();
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

        expect(screen.getByRole('alert')).toHaveTextContent('Could not load price alerts.');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(priceAlerts.reload).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/No price alerts yet/)).toBeNull();
    });

    it('creates a price alert from the empty state', async () => {
        render(<NotificationsSection walletId="wallet-1" />);
        expect(screen.getByText('No price alerts yet. Add one below.')).toBeTruthy();

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

        const time = screen.getByText('2 min ago');
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
