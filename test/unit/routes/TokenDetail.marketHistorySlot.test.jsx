// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The token's price chart is drawn behind the balance card. Whether or not a
// chart is drawn (including when the token record cannot be read) the chart
// slot stays in the card and fills it, so the card never changes height, and
// the page prints no pricing status text in its place.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
    return screen.getByRole('region', { name: 'Price chart' });
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
    it('keeps the empty chart slot and prints no status text when the token record cannot be read', async () => {
        renderToken('real-wallet', null, { readFails: true });
        const slot = await settledSlot();
        await vi.waitFor(() => expect(screen.getByRole('tab', { name: 'Details' })).toBeTruthy());
        expect(within(chartPanel()).queryByRole('img')).toBeNull();
        expect(document.body).not.toHaveTextContent('Market data is unavailable.');
        expect(document.body).not.toHaveTextContent('No price history yet');
        expect(inBalanceCard(slot)).toBe(true);
        expect(chartPanel().querySelectorAll('[class*="slot"]')).toHaveLength(1);
    });

    it('keeps the empty chart slot and shows no DEX trades when the token record has no market price', async () => {
        renderToken('real-wallet', { creator: 'bcrt1qx' });
        const slot = await settledSlot();
        expect(within(chartPanel()).queryByRole('img')).toBeNull();
        expect(document.body).not.toHaveTextContent('No price history yet');
        expect(inBalanceCard(slot)).toBe(true);
        expect(document.body).not.toHaveTextContent('Indexed market activity builds');
        expect(chartPanel().querySelectorAll('[class*="slot"]')).toHaveLength(1);
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('No DEX trades yet')).toBeTruthy();
    });

    it('draws the chart in the same slot when a price series loads', async () => {
        renderToken('demo-wallet', { creator: 'bcrt1qx', marketPrice: '0.5', totalSupply: '1000' });
        const chart = await screen.findByRole('img', { name: /^Price trend/ });
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
