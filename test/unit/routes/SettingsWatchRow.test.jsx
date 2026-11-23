// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const watchState = vi.hoisted(() => ({ available: false }));

vi.mock('../../../packages/core/src/shared/hooks/useWatchAvailable.js', () => ({
    useWatchAvailable: () => watchState.available,
}));

vi.mock('../../../packages/core/src/shared/components/settings/WatchSection.jsx', () => ({
    WatchSection: () => <div data-testid="watch-section" />,
}));

vi.mock('../../../packages/core/src/shared/components/settings/WatchAlertsRows.jsx', () => ({
    WatchAlertsRows: () => <div data-testid="watch-alerts-rows" />,
}));

vi.mock('../../../packages/core/src/shared/components/settings/WatchStatusRows.jsx', () => ({
    WatchStatusRows: () => <div data-testid="watch-status-rows" />,
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

const messaging = {
    getSettings: vi.fn(async () => createDefaultSettings()),
    listConnectedSites: vi.fn(async () => []),
    listBlockedOrigins: vi.fn(async () => []),
};

function renderSettings(shell) {
    return render(
        <MessagingContext.Provider value={{ shell, messaging }}>
            <Settings onBack={() => {}} />
        </MessagingContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
    watchState.available = false;
    vi.clearAllMocks();
});

describe('Settings Watch row', () => {
    it.each([
        ['web', 'web'],
        ['extension', 'popup'],
        ['desktop', 'desktop'],
    ])('is hidden on the %s shell', async (_label, shell) => {
        renderSettings(shell);

        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /^Watch/ })).toBeNull();
    });

    it('appears beside Notifications when the availability hook answers and opens every Watch section', async () => {
        watchState.available = true;
        renderSettings('web');

        const watchRow = await screen.findByRole('button', { name: /^Watch/ });
        const settingsRows = screen.getAllByRole('button');
        const notificationsIndex = settingsRows.findIndex((button) => /^Notifications/.test(button.textContent));
        expect(settingsRows.indexOf(watchRow)).toBe(notificationsIndex + 1);

        fireEvent.click(watchRow);

        expect(await screen.findByRole('heading', { level: 1, name: 'Watch' })).toBeTruthy();
        expect(screen.getByTestId('watch-section')).toBeTruthy();
        expect(screen.getByTestId('watch-alerts-rows')).toBeTruthy();
        expect(screen.getByTestId('watch-status-rows')).toBeTruthy();
    });
});
