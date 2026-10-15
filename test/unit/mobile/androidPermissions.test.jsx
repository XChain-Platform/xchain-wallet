// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { QrScanner } from '../../../packages/core/src/ui/QrScanner.jsx';

let settings;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings,
        loading: false,
        error: null,
        update: vi.fn(async () => settings),
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => ({
        alerts: [],
        loading: false,
        supported: false,
        error: null,
        addAlert: vi.fn(),
        removeAlert: vi.fn(),
        rearm: vi.fn(),
        reload: vi.fn(),
    }),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: {} }),
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const savedPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
const savedNotification = globalThis.Notification;

beforeEach(() => {
    settings = createDefaultSettings();
});

afterEach(() => {
    cleanup();
    delete window.Capacitor;
    delete window.BarcodeDetector;
    globalThis.Notification = savedNotification;
    if (savedMediaDevices) Object.defineProperty(navigator, 'mediaDevices', savedMediaDevices);
    else delete navigator.mediaDevices;
    if (savedPermissions) Object.defineProperty(navigator, 'permissions', savedPermissions);
    else delete navigator.permissions;
    vi.restoreAllMocks();
});

describe('Android runtime permission denials', () => {
    it('shows one camera message without requesting an already denied permission', async () => {
        window.Capacitor = { isNativePlatform: () => true };
        window.BarcodeDetector = function BarcodeDetector() { this.detect = async () => []; };
        const getUserMedia = vi.fn();
        const query = vi.fn(async () => ({ state: 'denied' }));
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: { query },
        });

        const view = render(<QrScanner onFrame={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue to camera' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Camera access is turned off for XChain Wallet.',
        );
        expect(query).toHaveBeenCalledTimes(1);
        expect(getUserMedia).not.toHaveBeenCalled();

        view.rerender(<QrScanner onFrame={vi.fn()} />);
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('turns a denied notification request into one message and one prompt', async () => {
        let finishRequest;
        const requestPermission = vi.fn(() => new Promise((resolve) => {
            finishRequest = resolve;
        }));
        globalThis.Notification = { permission: 'default', requestPermission };
        render(<NotificationsSection />);

        const button = screen.getByRole('button', { name: 'Request permission' });
        fireEvent.click(button);
        fireEvent.click(button);
        expect(requestPermission).toHaveBeenCalledTimes(1);

        finishRequest('denied');
        await waitFor(() => expect(screen.getByText(/Notifications are blocked/)).toHaveTextContent(
            'Open your browser or system settings, find XChain Wallet, and allow notifications.',
        ));
        expect(screen.queryByRole('button', { name: 'Request permission' })).toBeNull();
        expect(screen.getAllByText(/Notifications are blocked/)).toHaveLength(1);
    });
});
