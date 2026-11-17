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

function configure(activeNetwork, perTransaction, extra = {}) {
    settings = seedSettingsForChains(createDefaultSettings(), registry, chainIds);
    settings.activeNetwork = activeNetwork;
    settings.ads = { ...settings.ads, perTransaction, ...extra };
}

function summaryText() {
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Settings onBack={() => {}} initialSubpageId="g-network" />
        </MessagingProvider>,
    );
    return container.querySelector('[data-settings-row-id="ads"]')?.textContent ?? '';
}

afterEach(cleanup);

// The Automatic Donations row reads the wallet-wide fiat queue: the amount
// added per transaction, or Off. It never shows a coin-unit total, raw sats,
// or another network's donations.
describe('Settings donation summary', () => {
    it('shows the per-transaction amount in the display currency', () => {
        configure('mainnet', '0.05', { donated: '12.5', donationCount: 3 });
        const text = summaryText();
        expect(text).toContain('$0.05 per transaction');
        expect(text).not.toContain('sats donated');
        expect(text).not.toContain('12.5');
    });

    it('shows the same line while testnet is active', () => {
        configure('testnet', '0.10');
        expect(summaryText()).toContain('$0.10 per transaction');
    });

    it('shows off when the per-transaction amount is none', () => {
        configure('mainnet', '0', { queued: '5' });
        const text = summaryText();
        expect(text).toContain('Off');
        expect(text).not.toContain('per transaction');
    });
});
