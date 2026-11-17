// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Price Alerts list reads the alerts once and prices them by distinct
// asset, never per alert: the read count at 40 alerts equals the count at 2.
// The real usePriceAlerts and usePriceAlertPrices run; only the wallet's
// messaging and the price lookup are counted.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const lookup = vi.hoisted(() => ({
    refreshFiatRates: vi.fn(async () => ({ updated: true })),
    refreshTokenFiatRate: vi.fn(async () => ({ updated: true })),
    getFiatRate: vi.fn(({ chainCoin }) => ({ rate: { bitcoin: 68000, dogecoin: 0.12, litecoin: 80 }[chainCoin] ?? 1, fetchedAt: 1 })),
    getTokenFiatRate: vi.fn(() => ({ rate: 1.5, fetchedAt: 1 })),
    subscribeFiatRates: vi.fn(() => () => {}),
}));

vi.mock('../../../packages/core/src/flows/priceLookup.js', () => lookup);

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: createDefaultSettings(), loading: false, error: null, update: vi.fn() }),
}));

const { PriceAlertsSection } = await import(
    '../../../packages/core/src/shared/components/settings/PriceAlertsSection.jsx');

const COINS = ['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet'];

/** `count` alerts over the same three coins and one token, so the distinct assets stay fixed. */
function alertsOf(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: `alert-${i}`,
        walletId: 'wallet-1',
        chainId: COINS[i % COINS.length],
        ...(i % 4 === 3 ? { tick: 'XCHAIN', chainId: 'bitcoin-mainnet' } : {}),
        direction: i % 2 ? 'below' : 'above',
        targetFiat: 10 + i,
        fiatCurrency: 'usd',
        status: 'armed',
        createdAt: '2026-11-01T10:00:00.000Z',
        triggeredAt: null,
    }));
}

async function readsAt(count) {
    const messaging = {
        listPriceAlertsForWallet: vi.fn().mockResolvedValue(alertsOf(count)),
        savePriceAlert: vi.fn(),
        clearPriceAlert: vi.fn(),
        rearmPriceAlert: vi.fn(),
    };
    lookup.refreshFiatRates.mockClear();
    lookup.refreshTokenFiatRate.mockClear();
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PriceAlertsSection walletId="wallet-1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(count));
    // Let the price effects settle before counting.
    await waitFor(() => expect(lookup.refreshFiatRates).toHaveBeenCalled());
    const reads = {
        alertList: messaging.listPriceAlertsForWallet.mock.calls.length,
        coinPriceBatches: lookup.refreshFiatRates.mock.calls.length,
        tokenPrices: lookup.refreshTokenFiatRate.mock.calls.length,
    };
    view.unmount();
    return reads;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('Price Alerts list reads', () => {
    it('reads the alerts once and prices the distinct assets once, at 2 alerts and at 40', async () => {
        const two = await readsAt(2);
        const forty = await readsAt(40);

        expect(two.alertList).toBe(1);
        expect(forty).toEqual({ ...two, tokenPrices: forty.tokenPrices });
        // One batched coin read per display currency, and one read per distinct token.
        expect(forty.coinPriceBatches).toBe(1);
        expect(forty.alertList).toBe(1);
        expect(forty.tokenPrices).toBe(1);
        expect(lookup.refreshFiatRates.mock.calls[0][0].chainCoins).toEqual(['bitcoin', 'dogecoin', 'litecoin']);
    });

    it('adds no read when a re-render adds no new asset', async () => {
        const messaging = {
            listPriceAlertsForWallet: vi.fn().mockResolvedValue(alertsOf(40)),
            savePriceAlert: vi.fn(),
            clearPriceAlert: vi.fn(),
        };
        lookup.refreshFiatRates.mockClear();
        const tree = (
            <MessagingProvider shell="web" messaging={messaging}>
                <PriceAlertsSection walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>
        );
        const { rerender } = render(tree);
        await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(40));
        const before = lookup.refreshFiatRates.mock.calls.length;
        rerender(tree);
        rerender(tree);
        expect(lookup.refreshFiatRates.mock.calls.length).toBe(before);
        expect(messaging.listPriceAlertsForWallet).toHaveBeenCalledTimes(1);
    });
});
