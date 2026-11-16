// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const registry = defaultRegistry();
const chainIds = ['bitcoin-mainnet', 'dogecoin-mainnet', 'bitcoin-testnet'];
let settings = seedSettingsForChains(createDefaultSettings(), registry, chainIds);

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: async () => {} }),
}));

const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');
const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');

const messaging = {
    getSettings: () => new Promise(() => {}),
    listConnectedSites: () => Promise.resolve([]),
};

function configure(activeNetwork, donations, enabled = true) {
    settings = seedSettingsForChains(createDefaultSettings(), registry, chainIds);
    settings.activeNetwork = activeNetwork;
    settings.ads.enabled = enabled;
    for (const [chainId, lifetimeDonatedSats] of Object.entries(donations)) {
        settings.ads.perChain[chainId].lifetimeDonatedSats = lifetimeDonatedSats;
    }
}

function summaryText() {
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} />
        </MessagingProvider>,
    );
    return container.textContent;
}

afterEach(cleanup);

describe('Settings donation summary', () => {
    it('shows active mainnet donations in each coin unit', () => {
        configure('mainnet', {
            'bitcoin-mainnet': 25000,
            'dogecoin-mainnet': 125000000,
            'bitcoin-testnet': 999999,
        });
        const text = summaryText();
        expect(text).toContain('On · 0.00025 BTC, 1.25 DOGE donated');
        expect(text).not.toContain('125,000,000');
        expect(text).not.toContain('sats donated');
        expect(text).not.toContain('0.00999999');
    });

    it('shows zero when only another network has donated', () => {
        configure('mainnet', { 'bitcoin-testnet': 999999 });
        expect(summaryText()).toContain('On · 0 donated');
    });

    it('shows a testnet donation while testnet is active', () => {
        configure('testnet', { 'bitcoin-testnet': 500000 });
        expect(summaryText()).toContain('On · 0.005 BTC donated');
    });

    it('shows off when donations are disabled', () => {
        configure('mainnet', { 'bitcoin-mainnet': 25000 }, false);
        expect(summaryText()).toContain('Off');
    });
});
