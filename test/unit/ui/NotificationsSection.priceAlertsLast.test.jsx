// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Manage notifications keeps the Price alerts on/off master (G08) as the last
// switch in every shell, below Quiet hours and Sounds. The alert list, the
// Add form and every alert's page moved to the Price Alerts page, so the
// notifications panel carries no alert manager and reads no alerts.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { t } from '../../../packages/core/src/i18n/index.js';

let settings;
let update;
let shell = 'web';
const listAlerts = vi.fn();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => { listAlerts(); return { alerts: [] }; },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell, messaging: {} }),
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

let priorNotification;

beforeEach(() => {
    settings = createDefaultSettings();
    settings.notifications.priceAlerts = true;
    update = vi.fn().mockResolvedValue(settings);
    listAlerts.mockClear();
    priorNotification = globalThis.Notification;
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn() };
});

afterEach(() => {
    cleanup();
    globalThis.Notification = priorNotification;
    shell = 'web';
    vi.restoreAllMocks();
});

function precedes(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('Manage notifications order', () => {
    for (const shellName of ['web', 'desktop', 'extension']) {
        it(`renders the Price alerts switch after Quiet hours and Sounds on ${shellName}`, () => {
            shell = shellName;
            render(<NotificationsSection walletId="wallet-1" />);

            const priceSwitch = screen.getByRole('switch', { name: t('settings.notifications.priceAlerts') });
            expect(priceSwitch).toBeChecked();
            const quietHours = screen.getByRole('switch', { name: t('settings.notifications.pauseNotifications') });
            const sounds = screen.getByRole('switch', { name: t('settings.notifications.playNotificationSounds') });

            expect(precedes(quietHours, priceSwitch)).toBe(true);
            expect(precedes(sounds, priceSwitch)).toBe(true);
        });
    }

    it('carries no alert manager: no Add Alert form and no alert read', () => {
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.queryByRole('button', { name: 'Add Alert' })).toBeNull();
        expect(screen.queryByText('No price alerts yet')).toBeNull();
        expect(listAlerts).not.toHaveBeenCalled();
    });

    it('renders the Price alerts switch alone for the page that holds only the master', () => {
        render(<NotificationsSection only="priceAlerts" />);

        expect(screen.getAllByRole('switch')).toHaveLength(1);
        expect(screen.getByRole('switch', { name: t('settings.notifications.priceAlerts') })).toBeChecked();
    });
});
