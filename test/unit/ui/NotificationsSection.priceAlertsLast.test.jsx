// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Manage notifications puts Price alerts last: the Quiet hours and Sounds
// controls sit above the price-alert manager in every shell, and the Price
// alerts switch stays directly above the manager it unlocks.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { t } from '../../../packages/core/src/i18n/index.js';

let settings;
let update;
let priceAlerts;
let shell = 'web';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => priceAlerts,
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
        it(`renders Quiet hours and Sounds above the price-alert manager on ${shellName}`, () => {
            shell = shellName;
            render(<NotificationsSection walletId="wallet-1" />);

            const priceSwitch = screen.getByRole('switch', { name: t('settings.notifications.priceAlerts') });
            expect(priceSwitch).toBeChecked();
            const quietHours = screen.getByRole('switch', { name: t('settings.notifications.quietHours') });
            const sounds = screen.getByRole('switch', { name: t('settings.notifications.notificationSounds') });
            const manager = screen.getByRole('button', { name: 'Add alert' });

            expect(precedes(quietHours, manager)).toBe(true);
            expect(precedes(sounds, manager)).toBe(true);
            expect(precedes(priceSwitch, manager)).toBe(true);
        });
    }
});
