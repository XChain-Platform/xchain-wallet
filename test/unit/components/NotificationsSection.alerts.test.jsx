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
    screenVariantFor: () => 'full',
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');
const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

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
    it('renders a sparse settings record without a notification map', () => {
        settings = {};

        const { container } = render(<NotificationsSection />);

        expect(screen.getByRole('switch', { name: 'Transaction confirmations' })).not.toBeChecked();
        expect(screen.getByRole('switch', { name: 'Incoming pending payments' })).toBeChecked();
        expect(container.querySelector('[data-empty-state]')).toBeNull();
    });

    it('keeps only trigger details that add to category labels', () => {
        render(<NotificationsSection />);

        expect(screen.getByText('First confirmation of a sent transaction.')).toBeTruthy();
        expect(screen.getByText('Seen by the network before confirmation.')).toBeTruthy();
        expect(screen.getByText('Held-token polls; binding polls are flagged.')).toBeTruthy();
        expect(screen.queryByText(/Notify when a watched address receives a message/)).toBeNull();
        expect(screen.queryByText(/Notify when a DEX order/)).toBeNull();
    });

    it('requests and revokes the optional Chrome notification permission', async () => {
        const prior = globalThis.chrome;
        const contains = vi.fn(async () => false);
        const request = vi.fn(async () => true);
        const remove = vi.fn(async () => true);
        globalThis.chrome = { permissions: { contains, request, remove } };
        try {
            render(<NotificationsSection />);

            expect(await screen.findByRole('button', { name: 'Allow Notifications' })).toBeTruthy();
            expect(screen.getByText(/Optional\. Allows XChain Wallet/)).toHaveTextContent(
                'You can revoke access here at any time.',
            );
            const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
            expect(category).not.toBeChecked();
            expect(category).toBeDisabled();
            expect(request).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole('button', { name: 'Allow Notifications' }));

            await waitFor(() => expect(request).toHaveBeenCalledWith({ permissions: ['notifications'] }));
            await waitFor(() => expect(category).toBeChecked());
            expect(category).toBeEnabled();
            fireEvent.click(await screen.findByRole('button', { name: 'Revoke Permission' }));

            await waitFor(() => expect(remove).toHaveBeenCalledWith({ permissions: ['notifications'] }));
            expect(await screen.findByRole('button', { name: 'Allow Notifications' })).toBeTruthy();
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
            expect(await screen.findByRole('button', { name: 'Revoke Permission' })).toBeTruthy();
            const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
            expect(category).toBeChecked();

            granted = false;
            for (const listener of removedListeners) listener({ permissions: ['notifications'] });

            expect(await screen.findByRole('button', { name: 'Allow Notifications' })).toBeTruthy();
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
            expect(screen.queryByRole('button', { name: 'Request Permission' })).toBeNull();
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
    it('keeps the Price alerts master on the Notifications page and opens the list from its own row', () => {
        settings.notifications.priceAlerts = true;
        render(<Settings
            activeWallet={{ id: 'wallet-1', name: 'Test wallet' }}
            onBack={vi.fn()}
        />);

        fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
        // The on/off master is a switch on this page (G08); no alert depends on it.
        expect(screen.getByRole('switch', { name: 'Price alerts' })).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /^Your price alerts/ }));

        expect(screen.getByRole('heading', { level: 1, name: 'Price Alerts' })).toBeTruthy();
        expect(screen.queryByRole('switch', { name: 'Price alerts' })).toBeNull();
        expect(screen.getByText('No price alerts yet')).toBeTruthy();
    });
});
