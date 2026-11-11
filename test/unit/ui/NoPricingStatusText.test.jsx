// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A native coin with no current price says so once, in the market panel.
// The price alert entry adds no second boxed note about the same missing
// data; it renders only when a live price exists to prefill the alert.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/hooks/usePriceAlerts.js', () => ({
    usePriceAlerts: () => ({
        supported: true,
        alerts: [],
        loading: false,
        error: null,
        addAlert: vi.fn(),
        removeAlert: vi.fn(),
        refresh: vi.fn(),
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';

const MAINNET_CHAIN = 'bitcoin-mainnet';
const NO_ALERT_DATA = 'Price alerts need current market data.';
const NO_MARKET_DATA = 'No market data available for this network.';

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
});

function renderNative(priceResult) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD', activeNetwork: 'mainnet' }),
        getNativePricesRequest: vi.fn().mockResolvedValue(priceResult),
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
        listPriceAlertsForWallet: vi.fn().mockResolvedValue([]),
        savePriceAlert: vi.fn().mockResolvedValue(undefined),
        clearPriceAlert: vi.fn().mockResolvedValue(undefined),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="real-wallet"
                chainId={MAINNET_CHAIN}
                tick="BTC"
                kind="native"
                quantity="200000000"
                divisibility={8}
                fiatRate={50}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

describe('TokenDetail missing price status text', () => {
    it('states the missing market data once and draws no price alert box', async () => {
        renderNative({ prices: {}, error: 'Price source unavailable' });

        expect(await screen.findAllByText(NO_MARKET_DATA)).toHaveLength(1);
        expect(screen.queryByText(NO_ALERT_DATA)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Set price alert' })).toBeNull();
    });

    it('draws no price alert box when price data is turned off', async () => {
        renderNative({ disabled: true });

        await screen.findByText(/Price data is disabled/);
        expect(screen.queryByText(NO_ALERT_DATA)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Set price alert' })).toBeNull();
    });

    it('offers the price alert through More info when a live price exists', async () => {
        renderNative({
            prices: {
                [MAINNET_CHAIN]: {
                    priceFiat: 40000,
                    marketCapFiat: 1200000000,
                    change24hPct: 1.5,
                    sparkline: [39000, 40000],
                    fetchedAt: Date.now(),
                },
            },
        });

        await screen.findByText('$40,000.00');
        expect(screen.queryByRole('button', { name: 'Set price alert' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More info' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Set price alert' }));
        expect(await screen.findByRole('button', { name: 'Add alert' })).toBeTruthy();
        expect(screen.queryByText(NO_ALERT_DATA)).toBeNull();
        expect(screen.queryByText(NO_MARKET_DATA)).toBeNull();
    });
});
