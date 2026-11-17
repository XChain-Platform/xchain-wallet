// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The token's chart is drawn behind the balance card. Whatever is drawn
// (a price line, or with no price history the balance from the wallet's own
// rows, operator ruling 2026-11-15) the chart slot stays in the card and
// fills it, so the card never changes height, and the page prints no pricing
// status text in its place.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

beforeEach(() => window.localStorage.removeItem('xc:assetBalanceUnit'));

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function renderToken(walletId, assetInfo, { readFails = false } = {}) {
    const messaging = {
        getTokenInfo: readFails
            ? vi.fn().mockRejectedValue(new Error('explorer unreachable'))
            : vi.fn().mockResolvedValue(assetInfo),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId={walletId}
                chainId={CHAIN}
                tick="SLOTPROBE"
                kind="token"
                quantity="10"
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

function chartPanel() {
    return screen.getByRole('region', { name: /^(Price|Value|Balance) chart$/ });
}

function chartSlot() {
    return chartPanel().querySelector('[class*="slot"]');
}

function inBalanceCard(el) {
    return el.closest('[class*="heroStack"]') !== null;
}

async function settledSlot() {
    await screen.findByRole('region', { name: 'SLOTPROBE' });
    await vi.waitFor(() => {
        expect(chartPanel()).toHaveAttribute('data-chart-behind', 'true');
        expect(chartSlot()).not.toBeNull();
    });
    return chartSlot();
}

describe('token market history slot', () => {
    it('draws the balance line in the slot and prints no status text when the token record cannot be read', async () => {
        renderToken('real-wallet', null, { readFails: true });
        const slot = await settledSlot();
        await vi.waitFor(() => expect(screen.getByRole('tab', { name: 'Details' })).toBeTruthy());
        // No price line is invented; the hero draws the balance the wallet holds.
        expect(within(chartPanel()).queryByRole('img', { name: /^Price trend/ })).toBeNull();
        await vi.waitFor(() => expect(within(slot).getByRole('img', { name: /^Balance over 1W/ })).toBeTruthy());
        expect(document.body).not.toHaveTextContent('Market data is unavailable.');
        expect(document.body).not.toHaveTextContent('No price history yet');
        expect(inBalanceCard(slot)).toBe(true);
        expect(chartPanel().querySelectorAll('[class*="slot"]')).toHaveLength(1);
    });

    it('draws the balance line in the slot and shows no DEX trades when the token record has no market price', async () => {
        renderToken('real-wallet', { creator: 'bcrt1qx' });
        const slot = await settledSlot();
        expect(within(chartPanel()).queryByRole('img', { name: /^Price trend/ })).toBeNull();
        await vi.waitFor(() => expect(within(slot).getByRole('img', { name: /^Balance over 1W/ })).toBeTruthy());
        expect(document.body).not.toHaveTextContent('No price history yet');
        expect(inBalanceCard(slot)).toBe(true);
        expect(document.body).not.toHaveTextContent('Indexed market activity builds');
        expect(chartPanel().querySelectorAll('[class*="slot"]')).toHaveLength(1);
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('No DEX trades yet')).toBeTruthy();
    });

    it('draws the selected asset-unit series in the same slot when market data loads', async () => {
        renderToken('demo-wallet', { creator: 'bcrt1qx', marketPrice: '0.5', totalSupply: '1000' });
        const chart = await screen.findByRole('img', { name: /^Balance over 1W/ });
        const slot = chartSlot();
        expect(slot.contains(chart)).toBe(true);
        expect(slot.textContent).not.toContain('No price history yet');
        expect(inBalanceCard(slot)).toBe(true);
        expect(chartPanel().querySelectorAll('[class*="slot"]')).toHaveLength(1);
    });

    it('fills the card with the chart slot in both the chart and the empty states', () => {
        const css = readFileSync('packages/core/src/shared/components/PortfolioChart.module.css', 'utf8');
        const panel = /\.behind\s*>\s*\[role='tabpanel'\]\s*\{([^}]*)\}/s.exec(css)?.[1] || '';
        expect(panel).toMatch(/position:\s*absolute/);
        expect(panel).toMatch(/inset:\s*0/);
        const slot = /\.behind \.slot,\s*\.behind \.chart\s*\{([^}]*)\}/s.exec(css)?.[1] || '';
        expect(slot).toContain('block-size: 100%');
        expect(slot).toContain('min-block-size: 0');
    });
});
