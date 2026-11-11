// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const priorNotification = globalThis.Notification;

function setPermission(permission) {
    globalThis.Notification = { permission, requestPermission: vi.fn(async () => permission) };
}

function allButtons() {
    return Array.from(document.querySelectorAll('button'));
}

function successButtons() {
    return allButtons().filter((b) => /success/.test(b.className));
}

beforeEach(() => {
    settings = createDefaultSettings();
    settings.notifications = { ...settings.notifications, priceAlerts: true };
    settings.sounds = { ...settings.sounds, enabled: true };
    settings.quietHours = { enabled: true, start: '22:00', end: '08:00' };
    update = vi.fn().mockResolvedValue(settings);
    priceAlerts = {
        alerts: [
            { id: 'a1', chainId: 'bitcoin-mainnet', direction: 'above', targetFiat: 70000, fiatCurrency: 'usd', status: 'triggered' },
        ],
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
    globalThis.Notification = priorNotification;
    vi.restoreAllMocks();
});

describe('NotificationsSection forward action and icons', () => {
    it('shows Request permission and Add alert as green form actions, with icons', () => {
        setPermission('default');
        render(<NotificationsSection walletId="wallet-1" />);

        const request = screen.getByRole('button', { name: 'Request permission' });
        const addAlert = screen.getByRole('button', { name: 'Add alert' });
        expect(request.className).toMatch(/success/);
        expect(request.querySelector('svg')).not.toBeNull();
        expect(addAlert.className).toMatch(/success/);
        expect(addAlert.querySelector('svg')).not.toBeNull();
        expect(successButtons()).toEqual([request, addAlert]);
    });

    it('keeps only the price-alert form action green once permission is granted', () => {
        setPermission('granted');
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.queryByRole('button', { name: 'Request permission' })).toBeNull();
        expect(successButtons()).toEqual([
            screen.getByRole('button', { name: 'Add alert' }),
        ]);
    });

    it('gives the revoke button an icon and keeps it out of green', async () => {
        const prior = globalThis.chrome;
        globalThis.chrome = {
            permissions: {
                contains: vi.fn(async () => true),
                request: vi.fn(async () => true),
                remove: vi.fn(async () => true),
            },
        };
        try {
            render(<NotificationsSection walletId="wallet-1" />);
            const revoke = await screen.findByRole('button', { name: 'Revoke permission' });
            expect(revoke.querySelector('svg')).not.toBeNull();
            expect(revoke.className).not.toMatch(/success/);
            expect(successButtons()).toEqual([
                screen.getByRole('button', { name: 'Add alert' }),
            ]);
        } finally {
            globalThis.chrome = prior;
        }
    });

    it('gives every button an icon: alert rows, sound previews and the form', () => {
        setPermission('granted');
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.getByRole('button', { name: 'Re-arm' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Edit/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Remove/ })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /^Preview/ }).length).toBeGreaterThan(0);
        const bare = allButtons().filter((b) => !b.hasAttribute('aria-expanded') && b.querySelector('svg') === null);
        expect(bare.map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual([]);
    });

    it('keeps Remove danger and Re-arm, Edit and Preview out of green', () => {
        setPermission('granted');
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.getByRole('button', { name: /^Remove/ }).className).toMatch(/danger/);
        for (const name of ['Re-arm', /^Edit/]) {
            expect(screen.getByRole('button', { name })).not.toHaveProperty('className', expect.stringMatching(/success/));
        }
        expect(successButtons()).toEqual([
            screen.getByRole('button', { name: 'Add alert' }),
        ]);
    });
});

describe('NotificationsSection help tips', () => {
    it('puts a help tip on each quiet-hours time field', () => {
        setPermission('granted');
        render(<NotificationsSection walletId="wallet-1" />);

        const start = document.getElementById('quiet-hours-start');
        const end = document.getElementById('quiet-hours-end');
        for (const input of [start, end]) {
            const label = document.querySelector(`label[for="${input.id}"]`);
            expect(label.parentElement.querySelector('button[aria-expanded]')).not.toBeNull();
        }
        fireEvent.focus(start);
        expect(screen.getAllByText(/Alerts that arrive after this time are dropped/).length).toBeGreaterThan(0);
    });

    it('puts a help tip beside each sound family label', () => {
        setPermission('granted');
        render(<NotificationsSection walletId="wallet-1" />);

        expect(screen.getAllByRole('button', { name: /^About the .* sound$/ }).length).toBeGreaterThan(0);
    });
});
