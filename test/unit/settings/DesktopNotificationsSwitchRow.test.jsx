// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings > Notifications: the Desktop notifications switch row (asks for
// permission on first enable, reverts on denial, no Allow button) and the
// inline row CSS that never wraps its icon onto a line of its own.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { NotificationsPermissionInlineRow } = await import(
    '../../../packages/core/src/shared/routes/SettingsInlineRows.jsx');

const prior = globalThis.Notification;
const row = { id: 'notifications-permission', title: 'Desktop notifications', help: 'Why' };

function mockNotification(permission, requestResult) {
    const requestPermission = vi.fn(async () => {
        globalThis.Notification.permission = requestResult;
        return requestResult;
    });
    globalThis.Notification = { permission, requestPermission };
    return requestPermission;
}

let update;
let settings;

beforeEach(() => {
    settings = { notifications: {} };
    update = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
    globalThis.Notification = prior;
});

function renderRow() {
    return render(<NotificationsPermissionInlineRow row={row} leading={<span data-testid="icon" />} settings={settings} update={update} />);
}

describe('Desktop notifications switch row', () => {
    it('is a switch, off by default, with a real description and no Allow button', () => {
        mockNotification('default', 'default');
        renderRow();
        const sw = screen.getByRole('switch', { name: 'Desktop notifications' });
        expect(sw.checked).toBe(false);
        expect(screen.getByText(/shown by your system, even when this window is in the background/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
    });

    it('requests permission on first enable and stays on when granted', async () => {
        const request = mockNotification('default', 'granted');
        renderRow();
        fireEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
        await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { desktop: true } }));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Desktop notifications' }).checked).toBe(true));
    });

    it('reverts to off when permission is denied', async () => {
        const request = mockNotification('default', 'denied');
        renderRow();
        fireEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
        await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Desktop notifications' }).checked).toBe(false));
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText(/blocked/i)).toBeTruthy();
    });

    it('reverts to off when the prompt is dismissed', async () => {
        const request = mockNotification('default', 'default');
        renderRow();
        fireEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
        await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('switch', { name: 'Desktop notifications' }).checked).toBe(false);
        expect(update).not.toHaveBeenCalled();
    });

    it('turning it off saves the choice without asking again', async () => {
        const request = mockNotification('granted', 'granted');
        renderRow();
        const sw = screen.getByRole('switch', { name: 'Desktop notifications' });
        expect(sw.checked).toBe(true);
        fireEvent.click(sw);
        await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { desktop: false } }));
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Quiet hours page', () => {
    it('shows the times from the start with the switch first, even when off', async () => {
        vi.resetModules();
        vi.doMock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
            useSettings: () => ({
                settings: { quietHours: { enabled: false, start: '22:00', end: '08:00' }, notifications: {}, sounds: {} },
                loading: false, error: null, update: vi.fn(),
            }),
        }));
        vi.doMock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({ usePriceAlerts: () => ({ alerts: [], supported: true, loading: false }) }));
        vi.doMock('../../../packages/core/src/shared/useMessaging.js', () => ({ useMessaging: () => ({ shell: 'web', messaging: {} }) }));
        const { NotificationsSection } = await import('../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');
        const { container } = render(<NotificationsSection only="quiet" />);
        expect(screen.getByRole('switch', { name: 'Pause notifications' }).checked).toBe(false);
        expect(container.querySelector('#quiet-hours-start').value).toBe('22:00');
        expect(container.querySelector('#quiet-hours-end').value).toBe('08:00');
        expect(container.querySelector('[data-options-active="false"]')).toBeTruthy();
    });
});

describe('Settings inline row layout', () => {
    const css = readFileSync('packages/core/src/shared/components/settings/SettingsInlineRow.module.css', 'utf8');

    it('never wraps the icon onto its own line', () => {
        expect(css).toMatch(/\.row\s*\{[^}]*flex-wrap:\s*nowrap/s);
        expect(css).not.toMatch(/\.row\s*\{[^}]*flex-wrap:\s*wrap/s);
        expect(css).toMatch(/\.row\s*\{[^}]*align-items:\s*flex-start/s);
    });

    it('lets the text block shrink and wrap its own text', () => {
        // The copy shrinks from a zero basis but keeps room for a short title
        // and its help icon, so a dropdown never draws over it (2026-11-15).
        expect(css).toMatch(/\.copy\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*min\(9rem, 45%\)/s);
        // Those limits outrank the phone-width page clamp in Settings.module.css,
        // and the copy column stays single-line so its title trims.
        expect(css).toMatch(/\.row\[data-settings-inline\] > \.copy\s*\{[^}]*min-width:\s*min\(9rem, 45%\)/s);
        expect(css).toMatch(/\.row\.row\[data-settings-inline\] > \.copy\s*\{[^}]*flex-wrap:\s*nowrap !important/s);
        expect(css).toMatch(/\.row\[data-settings-inline\] > \.control\s*\{[^}]*max-width:\s*55%/s);
        expect(css).toMatch(/\.row > \.switch\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0/s);
        expect(css).toMatch(/\.row > :first-child[^{]*\{[^}]*flex:\s*0 0 auto/s);
    });
});
