// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Disconnect confirmation and the permission labels read from the
// dictionary: under the pseudo locale their text carries the ⟦ ⟧ wrapper.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { setLocale } from '../../../packages/core/src/i18n/index.js';

let messaging;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: createDefaultSettings(), loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

const { ConnectedSitesSection } = await import(
    '../../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx'
);

beforeEach(async () => {
    messaging = {
        listConnectedSites: vi.fn(async () => [{
            schemaVersion: 1,
            id: 's1',
            origin: 'https://example.com',
            appName: 'Example',
            appIcon: '',
            connectedAt: '2026-10-01T00:00:00.000Z',
            lastUsedAt: '2026-10-01T00:00:00.000Z',
            permissions: { chains: [], accounts: [], canSignMessage: false, canSignAction: {} },
            sessionHistory: [],
        }]),
        listBlockedOrigins: vi.fn(async () => []),
        listBlocklistAuditLog: vi.fn(async () => []),
        blockOrigin: vi.fn(),
        unblockOrigin: vi.fn(),
        deleteConnectedSite: vi.fn(),
    };
    await setLocale('pseudo-rtl');
});
afterEach(async () => {
    cleanup();
    await setLocale('en');
});

describe('Connected sites copy goes through the dictionary', () => {
    it('the Disconnect confirmation is translated', async () => {
        render(<ConnectedSitesSection />);
        const buttons = await screen.findAllByRole('button', { name: /Disconnect/ });
        fireEvent.click(buttons[0]);
        expect(await screen.findByText(/⟦Disconnect Example\?⟧/)).toBeTruthy();
        expect(screen.getByText(/⟦https:\/\/example\.com will lose access/)).toBeTruthy();
    });
});
