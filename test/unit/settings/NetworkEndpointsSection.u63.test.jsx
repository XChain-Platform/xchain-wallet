// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U63 and U57 on Settings > Network endpoints: Save is the one green,
// iconed, named action ("Save endpoints"), Reset to default and the
// registry refresh carry icons, and every URL field has its own tip.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let settingsRecord;
let messagingRecord;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: settingsRecord, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingRecord }),
}));

const { NetworkEndpointsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx'
);

beforeEach(() => {
    settingsRecord = { developerMode: true, sdkEndpoints: {} };
    messagingRecord = {
        getChainRegistryStatus: vi.fn(() => Promise.resolve({ ok: true, descriptorCount: 3, lastRefreshedAt: null })),
        refreshChainRegistry: vi.fn(() => Promise.resolve({ ok: true, descriptorCount: 3 })),
    };
});
afterEach(() => cleanup());

function bitcoin() {
    return screen.getByRole('region', { name: 'Bitcoin' });
}

describe('Network endpoints actions (U63)', () => {
    it('makes Save endpoints the one green action with an icon once a field is edited', () => {
        render(<NetworkEndpointsSection />);
        const block = bitcoin();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), {
            target: { value: 'https://explorer.example.com' },
        });
        const save = within(block).getByRole('button', { name: 'Save endpoints' });
        expect(save.className).toMatch(/success/);
        expect(save.querySelector('svg')).not.toBeNull();
        expect(within(block).queryByRole('button', { name: 'Save' })).toBeNull();
        const reset = within(block).getByRole('button', { name: /Reset to default/ });
        expect(reset.querySelector('svg')).not.toBeNull();
        expect(reset.className).not.toMatch(/success/);
        expect(document.querySelectorAll('button[class*="success"]')).toHaveLength(1);
    });

    it('draws an icon on the registry refresh button', async () => {
        render(<NetworkEndpointsSection />);
        const refresh = await screen.findByRole('button', { name: /Refresh/ });
        expect(refresh.querySelector('svg')).not.toBeNull();
    });
});

describe('Network endpoints group spacing (U33)', () => {
    it('wraps the chain groups in the inset container that outranks card flattening', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync('packages/core/src/shared/components/settings/NetworkEndpointsSection.module.css', 'utf8');
        expect(css).toMatch(/\.groups\.groups\.groups > \*\s*\{\s*padding-block:\s*var\(--xc-space-3\);/);
        expect(css).toMatch(/\.groups\.groups\.groups > \* \+ \*\s*\{\s*border-block-start:\s*1px solid var\(--xc-border\);/);
        render(<NetworkEndpointsSection />);
        expect(bitcoin().parentElement.className).toMatch(/groups/);
    });
});

describe('Network endpoints tips (U57)', () => {
    it('gives each URL field its own written tip', () => {
        render(<NetworkEndpointsSection />);
        const block = bitcoin();
        const tips = within(block).getAllByRole('button', { name: /More info|About/ });
        expect(tips.length).toBeGreaterThanOrEqual(3);
        fireEvent.click(tips[0]);
        expect(within(block).getByText(/reads balances, history and token data/)).toBeTruthy();
    });
});
