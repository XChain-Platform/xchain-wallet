// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: price-change periods and recorded history.
//
//   [P1] 2026-10-13: Home change figures omit the period they measure,
//        while TokenDetail labels its figure 24h.
//
//   [P1] 2026-10-13: TokenDetail opens a real native asset on a synthetic-only
//        30d range, so it says no history while Home draws the recorded 7d line.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../packages/core/src/shared/components/PortfolioChart.jsx';
import { TotalBalanceHero } from '../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { TokenDetail } from '../../packages/core/src/shared/routes/TokenDetail.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const PRICE_HISTORY_REQUEST = {
    chainIds: [CHAIN_ID],
    includeSparkline: true,
    fiatCurrency: 'USD',
};
const SPARKLINE = Array.from({ length: 168 }, (_, index) => 70_000 + index * 50);
const PRICE_ENTRY = {
    priceFiat: 80_000,
    marketCapFiat: 1_500_000_000_000,
    change24hPct: 10,
    sparkline: SPARKLINE,
    fetchedAt: Date.now(),
};
const ROWS = [{
    kind: 'native',
    chainId: CHAIN_ID,
    tick: 'BTC',
    quantity: '50000000',
    divisibility: 8,
    fiatRate: 80_000,
}];

function createMessaging() {
    return {
        getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
        getNativePricesRequest: vi.fn(async () => ({
            prices: { [CHAIN_ID]: PRICE_ENTRY },
        })),
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [] })),
        listPriceAlertsForWallet: vi.fn(async () => []),
    };
}

function renderWithMessaging(messaging, children) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {children}
        </MessagingProvider>,
    );
}

function renderedLabel(element) {
    return `${element.textContent || ''} ${element.getAttribute('aria-label') || ''}`;
}

function changeFigure(container) {
    return [...container.querySelectorAll('[aria-label]')]
        .find((element) => /^(Increase|Decrease|No change):/.test(
            element.getAttribute('aria-label') || '',
        ));
}

function nativeTokenDetail() {
    return (
        <TokenDetail
            walletId="real-wallet"
            chainId={CHAIN_ID}
            tick="BTC"
            kind="native"
            quantity="50000000"
            fiatRate={80_000}
            onBack={() => {}}
        />
    );
}

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

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('regression/price-change-periods', () => {
    it('[REGRESSION P1] labels every Home and TokenDetail price change with its period', async () => {
        const messaging = createMessaging();
        const home = renderWithMessaging(messaging, (
            <>
                <TotalBalanceHero rows={ROWS} walletId="real-wallet" networkFilter="all" />
                <PortfolioChart rows={ROWS} walletId="real-wallet" />
            </>
        ));

        const balanceSummary = await screen.findByLabelText('Balance summary');
        const portfolio = screen.getByRole('region', { name: 'Portfolio performance' });
        await within(portfolio).findByRole('img', { name: /^Portfolio performance chart/ });

        const balanceChange = changeFigure(balanceSummary);
        const portfolioChange = changeFigure(portfolio);
        expect(balanceChange).toBeTruthy();
        expect(portfolioChange).toBeTruthy();
        expect.soft(renderedLabel(balanceChange)).toMatch(/\b24h\b/i);
        expect.soft(renderedLabel(portfolioChange)).toMatch(/\b7d\b/i);

        home.unmount();
        renderWithMessaging(messaging, nativeTokenDetail());

        const detailChange = await screen.findByText('+10.00%');
        expect.soft(renderedLabel(detailChange.parentElement)).toMatch(/\b24h\b/i);
    });

    it('[REGRESSION P1] draws the same recorded price history on Home and TokenDetail', async () => {
        const messaging = createMessaging();
        const home = renderWithMessaging(
            messaging,
            <PortfolioChart rows={ROWS} walletId="real-wallet" />,
        );

        expect(await screen.findByRole('img', { name: /^Portfolio performance chart\. Range 7d\./ }))
            .toBeInTheDocument();
        expect(screen.queryByText(/No price history/)).toBeNull();

        home.unmount();
        renderWithMessaging(messaging, nativeTokenDetail());

        await waitFor(() => expect(messaging.getNativePricesRequest)
            .toHaveBeenCalledWith(PRICE_HISTORY_REQUEST));
        expect(await screen.findByRole('img', { name: /^Price trend\. Range 7d\./ }))
            .toBeInTheDocument();
        expect(screen.queryByText('No price history yet')).toBeNull();
    });
});
