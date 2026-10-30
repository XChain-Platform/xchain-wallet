// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Under the pseudo locale every translated string is wrapped in ⟦ ⟧, so a
// string that shows without the wrapper is hard-coded English that no
// translation can reach.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { setLocale } from '../../../packages/core/src/i18n/index.js';

let messaging;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { ...createDefaultSettings(), developerMode: true },
        loading: false,
        error: null,
        update: vi.fn(),
    }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

const { WalletModeSection } = await import(
    '../../../packages/core/src/shared/components/settings/WalletModeSection.jsx'
);
const { NetworkEndpointsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx'
);

beforeEach(async () => {
    messaging = {
        getChainRegistryStatus: vi.fn(async () => null),
        refreshChainRegistry: vi.fn(),
    };
    await setLocale('pseudo-rtl');
});
afterEach(async () => {
    cleanup();
    await setLocale('en');
});

describe('settings copy goes through the dictionary', () => {
    it('wallet mode labels and hints are translated', () => {
        render(<WalletModeSection />);
        for (const text of ['Normal', 'Watcher (watch-only)', 'Signer (air-gapped)']) {
            expect(screen.getByText(new RegExp(`⟦${text.replace(/[()]/g, '\\$&')}⟧`))).toBeTruthy();
        }
        expect(screen.getByText(/⟦Sign and broadcast transactions on this device/)).toBeTruthy();
    });

    it('the registry refresh status line is translated', async () => {
        render(<NetworkEndpointsSection />);
        await waitFor(() => expect(screen.getByText(/⟦No refresh yet/)).toBeTruthy());
    });
});
