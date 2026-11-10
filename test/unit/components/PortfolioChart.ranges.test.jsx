// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every price chart offers one range list for every wallet, demo or real:
// 24h, 1W, 1M, 3M, 6M, 1Y, YTD and All. A range with no recorded history
// shows the empty-history message in the chart slot while the tabs stay.

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';

const LABELS = ['24h', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'All'];
const MAINNET_CHAIN = 'bitcoin-mainnet';
const ROWS = [{ kind: 'native', chainId: MAINNET_CHAIN, tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80000 }];
const SPARKLINE = Array.from({ length: 168 }, (_, i) => 70000 + i * 50);

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
    clearDemoWalletId();
    __clearTokenInfoCache();
});

function tabLabels(tablist) {
    return within(tablist).getAllByRole('tab').map((tab) => tab.textContent);
}

function selectedLabel(tablist) {
    return within(tablist).getAllByRole('tab')
        .find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;
}

function mountPortfolio(walletId) {
    const messaging = {
        getSettings: vi.fn(async () => ({})),
        getNativePricesRequest: vi.fn(async () => ({ prices: { [MAINNET_CHAIN]: { sparkline: SPARKLINE } } })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PortfolioChart rows={ROWS} walletId={walletId} />
        </MessagingProvider>,
    );
}

function mountNativeDetail(walletId) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
        getNativePricesRequest: vi.fn().mockResolvedValue({
            prices: {
                [MAINNET_CHAIN]: {
                    priceFiat: 40000,
                    marketCapFiat: 1200000000,
                    change24hPct: 1.5,
                    sparkline: SPARKLINE,
                    fetchedAt: Date.now(),
                },
            },
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
        listPriceAlertsForWallet: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId={walletId}
                chainId={MAINNET_CHAIN}
                tick="BTC"
                kind="native"
                quantity="200000000"
                divisibility={8}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

describe('PortfolioChart range list', () => {
    it('offers every range on a real wallet, opening on 1W', async () => {
        mountPortfolio('real-wallet-1');
        await waitFor(() => expect(document.querySelector('svg polyline')).not.toBeNull());
        const tablist = screen.getByRole('tablist', { name: 'Chart range' });
        expect(tabLabels(tablist)).toEqual(LABELS);
        expect(selectedLabel(tablist)).toBe('1W');
    });

    it('offers every range on the demo wallet, opening on 1M', async () => {
        markDemoWallet('demo-wallet-1');
        mountPortfolio('demo-wallet-1');
        await waitFor(() => expect(document.querySelector('svg polyline')).not.toBeNull());
        const tablist = screen.getByRole('tablist', { name: 'Chart range' });
        expect(tabLabels(tablist)).toEqual(LABELS);
        expect(selectedLabel(tablist)).toBe('1M');
    });

    it('says a real wallet has no history for a range beyond its recorded week and keeps the tabs', async () => {
        mountPortfolio('real-wallet-1');
        await waitFor(() => expect(document.querySelector('svg polyline')).not.toBeNull());
        fireEvent.click(screen.getByRole('tab', { name: '1Y' }));
        expect(await screen.findByText(/No price history/)).toBeTruthy();
        expect(document.querySelector('svg polyline')).toBeNull();
        expect(tabLabels(screen.getByRole('tablist', { name: 'Chart range' }))).toEqual(LABELS);
    });
});

describe('TokenDetail range list', () => {
    it('offers every range on a real wallet, opening on 1W', async () => {
        mountNativeDetail('real-wallet-1');
        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(tabLabels(tablist)).toEqual(LABELS);
        expect(selectedLabel(tablist)).toBe('1W');
    });

    it('offers every range on the demo wallet, opening on 1M', async () => {
        markDemoWallet('demo-wallet-1');
        mountNativeDetail('demo-wallet-1');
        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(tabLabels(tablist)).toEqual(LABELS);
        expect(selectedLabel(tablist)).toBe('1M');
    });

    it('keeps the tabs when a real wallet picks a range with no recorded history', async () => {
        mountNativeDetail('real-wallet-1');
        await screen.findByLabelText('1W price chart');
        fireEvent.click(screen.getByRole('tab', { name: '3M' }));
        expect(await screen.findByText('No price history yet')).toBeTruthy();
        const tablist = screen.getByRole('tablist', { name: 'Chart range' });
        expect(tabLabels(tablist)).toEqual(LABELS);
        expect(selectedLabel(tablist)).toBe('3M');
        fireEvent.click(within(tablist).getByRole('tab', { name: '24h' }));
        expect(await screen.findByLabelText('24h price chart')).toBeTruthy();
    });
});
