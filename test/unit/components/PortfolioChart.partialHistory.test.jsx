// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const DAY = 86_400_000;

const ROWS = [
    { kind: 'native', chainId: BTC, tick: 'BTC', displayName: 'Bitcoin', quantity: '50000000', divisibility: 8, fiatRate: 80_000 },
    { kind: 'native', chainId: LTC, tick: 'LTC', displayName: 'Litecoin', quantity: '100000000', divisibility: 8, fiatRate: 100 },
];
const THREE_ROWS = [
    ...ROWS,
    { kind: 'native', chainId: DOGE, tick: 'DOGE', displayName: 'Dogecoin', quantity: '100000000', divisibility: 8, fiatRate: 0.5 },
];

function history(start) {
    return Array.from({ length: 40 }, (_, index) => [
        Date.now() - (39 - index) * DAY,
        start + index,
    ]);
}

const BTC_HISTORY = history(60_000);
const LTC_HISTORY = history(70);
const DOGE_HISTORY = history(0.08);

function basePrices(rows = ROWS, histories = {}) {
    return Object.fromEntries(rows.map((row) => [row.chainId, {
        sparkline: [1, 2],
        ...(histories[row.chainId] ? { historyDaily: histories[row.chainId] } : {}),
    }]));
}

function mount({
    rows = ROWS,
    walletId = 'real-wallet-1',
    prices = basePrices(rows),
    request = async () => ({ prices: {} }),
} = {}) {
    const messaging = {
        getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
        getNativePricesRequest: vi.fn(request),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PortfolioChart
                rows={rows}
                walletId={walletId}
                nativePriceMap={prices}
                nativePricesLoading={false}
            />
        </MessagingProvider>,
    );
    return { messaging, ...view };
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

async function selectDailyRange() {
    fireEvent.click(screen.getByRole('tab', { name: '1M' }));
    await flush();
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.useRealTimers();
});

describe('PortfolioChart partial daily history retries', () => {
    it('retries only Bitcoin after 2 s, 4 s, and 8 s, then stops', async () => {
        vi.useFakeTimers();
        let call = 0;
        const { messaging } = mount({
            request: async () => {
                call += 1;
                if (call === 2) throw new Error('rate limited');
                return { prices: {
                    [BTC]: { historyDaily: null },
                    ...(call === 1 ? { [LTC]: { historyDaily: LTC_HISTORY } } : {}),
                } };
            },
        });
        await selectDailyRange();

        expect(messaging.getNativePricesRequest).toHaveBeenCalledTimes(1);
        expect(messaging.getNativePricesRequest.mock.calls[0][0].chainIds).toEqual([BTC, LTC]);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(messaging.getNativePricesRequest.mock.calls[1][0].chainIds).toEqual([BTC]);
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(messaging.getNativePricesRequest.mock.calls[2][0].chainIds).toEqual([BTC]);
        await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
        expect(messaging.getNativePricesRequest.mock.calls[3][0].chainIds).toEqual([BTC]);
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(messaging.getNativePricesRequest).toHaveBeenCalledTimes(4);
    });

    it('fills a successful retry into the full portfolio sum and removes the notice', async () => {
        vi.useFakeTimers();
        let call = 0;
        mount({
            request: async () => {
                call += 1;
                return call === 1
                    ? { prices: { [BTC]: { historyDaily: null }, [LTC]: { historyDaily: LTC_HISTORY } } }
                    : { prices: { [BTC]: { historyDaily: BTC_HISTORY } } };
            },
        });
        await selectDailyRange();

        expect(screen.getByText('Leaves out Bitcoin: no price history for this range.')).toBeInTheDocument();
        expect(screen.getByRole('img')).toHaveAccessibleName(/End \$100\.00 USD/);

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        expect(screen.getByRole('img')).toHaveAccessibleName(/End \$40,100\.00 USD/);
        expect(screen.queryByText(/Leaves out/)).toBeNull();
    });

    it('never replaces a good held series with a later null', async () => {
        vi.useFakeTimers();
        const { messaging } = mount({
            prices: basePrices(ROWS, { [BTC]: BTC_HISTORY }),
            request: async () => ({ prices: {
                [BTC]: { historyDaily: null },
                [LTC]: { historyDaily: LTC_HISTORY },
            } }),
        });
        await selectDailyRange();

        expect(screen.getByRole('img')).toHaveAccessibleName(/End \$40,100\.00 USD/);
        expect(screen.queryByText(/Leaves out/)).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
        expect(messaging.getNativePricesRequest).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending retry when unmounted', async () => {
        vi.useFakeTimers();
        const { messaging, unmount } = mount({
            request: async () => ({ prices: {
                [BTC]: { historyDaily: null },
                [LTC]: { historyDaily: LTC_HISTORY },
            } }),
        });
        await selectDailyRange();
        unmount();

        await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
        expect(messaging.getNativePricesRequest).toHaveBeenCalledTimes(1);
    });
});

describe('PortfolioChart partial-history notice', () => {
    it('names a missing coin by its display name beneath the chart', async () => {
        vi.useFakeTimers();
        mount({ request: async () => ({ prices: {
            [BTC]: { historyDaily: null },
            [LTC]: { historyDaily: LTC_HISTORY },
        } }) });
        await selectDailyRange();

        const notice = screen.getByText('Leaves out Bitcoin: no price history for this range.');
        expect(notice.previousElementSibling).toBeTruthy();
    });

    it('lists two missing native coins together', async () => {
        vi.useFakeTimers();
        mount({
            rows: THREE_ROWS,
            request: async () => ({ prices: {
                [BTC]: { historyDaily: null },
                [LTC]: { historyDaily: null },
                [DOGE]: { historyDaily: DOGE_HISTORY },
            } }),
        });
        await selectDailyRange();

        expect(screen.getByText('Leaves out Bitcoin and Litecoin: no price history for this range.')).toBeInTheDocument();
    });

    it('shows no notice when every valued native coin contributes', async () => {
        vi.useFakeTimers();
        mount({ request: async () => ({ prices: {
            [BTC]: { historyDaily: BTC_HISTORY },
            [LTC]: { historyDaily: LTC_HISTORY },
        } }) });
        await selectDailyRange();

        expect(screen.getByRole('img')).toHaveAccessibleName(/End \$40,100\.00 USD/);
        expect(screen.queryByText(/Leaves out/)).toBeNull();
    });

    it('never shows the notice for a demo wallet', async () => {
        vi.useFakeTimers();
        markDemoWallet('demo-wallet-1');
        const { messaging } = mount({
            walletId: 'demo-wallet-1',
            prices: {},
        });
        await flush();

        expect(screen.getByRole('img')).toBeInTheDocument();
        expect(screen.queryByText(/Leaves out/)).toBeNull();
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });

    it('keeps the no-history message when no coin contributes', async () => {
        vi.useFakeTimers();
        mount({ request: async () => ({ prices: {
            [BTC]: { historyDaily: null },
            [LTC]: { historyDaily: null },
        } }) });
        await selectDailyRange();

        expect(screen.getByText('No price history for this range yet.')).toBeInTheDocument();
        expect(screen.queryByText(/Leaves out/)).toBeNull();
    });
});
