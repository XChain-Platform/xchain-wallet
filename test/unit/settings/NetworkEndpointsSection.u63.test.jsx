// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U63, U57 and the walk rulings on Settings > Network endpoints: Save is the
// one green, iconed, named action, guidance uses the Notice Standard, and the
// registry refresh is a full standard list row.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let settingsRecord;
let messagingRecord;
let settingsUpdate;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: settingsRecord, loading: false, error: null, update: settingsUpdate }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingRecord }),
}));

const { EndpointsHarness } = await import('../components/networkRowHarness.jsx');

beforeEach(() => {
    settingsRecord = { developerMode: true, sdkEndpoints: {} };
    settingsUpdate = vi.fn();
    messagingRecord = {
        getChainRegistryStatus: vi.fn(() => Promise.resolve({ ok: true, descriptorCount: 3, lastRefreshedAt: null })),
        refreshChainRegistry: vi.fn(() => Promise.resolve({ ok: true, descriptorCount: 3 })),
    };
});
afterEach(() => cleanup());

// The page lists networks; open Bitcoin's own page first (G117).
function bitcoin() {
    fireEvent.click(document.querySelector('[data-network-row="bitcoin-mainnet"] button'));
    return screen.getByRole('region', { name: 'Bitcoin' });
}

describe('Network endpoints actions (U63)', () => {
    it('makes Save endpoints the one green action with an icon once a field is edited', () => {
        render(<EndpointsHarness />);
        const block = bitcoin();
        const save = within(block).getByRole('button', { name: 'Save Endpoints' });
        const explorer = within(block).getByRole('textbox', { name: 'Explorer URL' });
        expect(save).toBeEnabled();
        fireEvent.click(save);
        expect(settingsUpdate).not.toHaveBeenCalled();
        expect(explorer).toHaveAttribute('aria-invalid', 'true');
        expect(within(block).getAllByText('Change at least one endpoint before saving.').length).toBeGreaterThan(0);

        fireEvent.change(explorer, {
            target: { value: 'https://explorer.example.com' },
        });
        expect(explorer).not.toHaveAttribute('aria-invalid', 'true');
        expect(save.className).toMatch(/success/);
        expect(save.querySelector('svg')).not.toBeNull();
        expect(within(block).queryByRole('button', { name: 'Save' })).toBeNull();
        const reset = within(block).getByRole('button', { name: /Reset to Default/ });
        expect(reset.querySelector('svg')).not.toBeNull();
        expect(reset.className).not.toMatch(/success/);
        expect(document.querySelectorAll('button[class*="success"]')).toHaveLength(1);
    });

    it('draws registry refresh as a full list row with an icon and chevron', async () => {
        render(<EndpointsHarness />);
        const refresh = await screen.findByRole('button', { name: /Refresh/ });
        expect(refresh.querySelector('svg')).not.toBeNull();
        expect(refresh.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(refresh.closest('ul')).not.toBeNull();
    });
});

describe('Network endpoints form layout', () => {
    it('starts with one static notice and does not repeat the page title', () => {
        render(<EndpointsHarness />);
        const block = bitcoin();
        const notice = within(block).getByTestId('endpoint-guidance');
        expect(notice).toHaveAttribute('data-tone', 'info');
        expect(notice).toHaveTextContent(/Saving points this network/);
        expect(within(block).queryByRole('heading', { name: 'Bitcoin' })).toBeNull();
        expect(notice.compareDocumentPosition(within(block).getByLabelText('Explorer URL'))
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('Network endpoints tips (U57)', () => {
    it('gives each URL field its own written tip', () => {
        render(<EndpointsHarness />);
        const block = bitcoin();
        const tips = within(block).getAllByRole('button', { name: /More info|About/ });
        expect(tips.length).toBeGreaterThanOrEqual(3);
        fireEvent.click(tips[0]);
        expect(within(block).getByText(/reads balances, history and token data/)).toBeTruthy();
    });
});
