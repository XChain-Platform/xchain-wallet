// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const settings = createDefaultSettings();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));

const { NotificationsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('NotificationsSection native permission', () => {
    it('shows and requests the permission state reported by XChainNotify', async () => {
        const permissionState = vi.fn(async () => ({ state: 'prompt-with-rationale' }));
        const requestPermission = vi.fn(async () => ({ state: 'granted' }));
        vi.stubGlobal('Notification', undefined);
        vi.stubGlobal('Capacitor', {
            isNativePlatform: () => true,
            Plugins: { XChainNotify: { permissionState, requestPermission } },
        });

        render(<NotificationsSection />);

        const request = await screen.findByRole('button', { name: 'Request Permission' });
        const category = screen.getByRole('switch', { name: 'Transaction confirmations' });
        expect(permissionState).toHaveBeenCalledOnce();
        expect(category).toBeDisabled();

        fireEvent.click(request);

        await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
        await waitFor(() => expect(category).toBeEnabled());
        expect(screen.getByText(/Allowed\. Use the categories below/)).toBeTruthy();
    });
});
