// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    PortfolioChart,
    RANGES,
    priceHistoryForRange,
    rangeWindowStart,
} from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN_ID = 'bitcoin-mainnet';
const NOW = new Date(2026, 10, 10, 12, 0, 0, 0).getTime();
const SPARKLINE = Array.from({ length: 168 }, (_, index) => 70_000 + index);
const ROWS = [{
    kind: 'native', chainId: CHAIN_ID, tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80_000,
}];

const DAY_MS = 86_400_000;

// The source's daily points sit at 00:00 UTC, one per day, plus a final
// point at the time of the fetch; nothing is ever later than `now`.
function dailyHistory(now = NOW, days = 400) {
    const local = new Date(now);
    const today = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
    const points = [];
    for (let ago = days; ago >= 0; ago -= 1) {
        const timestamp = today - ago * DAY_MS;
        if (timestamp < now) points.push([timestamp, days - ago + 1]);
    }
    points.push([now, days + 2]);
    return points;
}

function range(id) {
    return RANGES.find((item) => item.id === id);
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function baseEntry(overrides = {}) {
    return {
        priceFiat: 80_000,
        marketCapFiat: 1_500_000_000_000,
        change24hPct: 1.25,
        sparkline: SPARKLINE,
        fetchedAt: NOW,
        ...overrides,
    };
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

afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    __clearTokenInfoCache();
});

describe('calendar price-history windows', () => {
    it('opens each daily window at the 00:00 UTC point of its local calendar day', () => {
        expect(rangeWindowStart('1m', NOW)).toBe(Date.UTC(2026, 9, 10));
        expect(rangeWindowStart('3m', NOW)).toBe(Date.UTC(2026, 7, 10));
        expect(rangeWindowStart('6m', NOW)).toBe(Date.UTC(2026, 4, 10));
        expect(rangeWindowStart('1y', NOW)).toBe(Date.UTC(2025, 10, 10));
        expect(rangeWindowStart('ytd', NOW)).toBe(Date.UTC(2026, 0, 1));
        expect(rangeWindowStart('all', NOW)).toBe(-Infinity);
        expect(rangeWindowStart('24h', NOW)).toBeNaN();
    });

    it('lands a month back from the 31st on the earlier month\'s last day', () => {
        expect(rangeWindowStart('1m', new Date(2026, 2, 31, 12).getTime())).toBe(Date.UTC(2026, 1, 28));
        expect(rangeWindowStart('1m', new Date(2024, 2, 31, 12).getTime())).toBe(Date.UTC(2024, 1, 29));
        expect(rangeWindowStart('3m', new Date(2026, 4, 31, 12).getTime())).toBe(Date.UTC(2026, 1, 28));
        expect(rangeWindowStart('1m', new Date(2026, 0, 15, 12).getTime())).toBe(Date.UTC(2025, 11, 15));
        expect(rangeWindowStart('1y', new Date(2024, 1, 29, 12).getTime())).toBe(Date.UTC(2023, 1, 28));
    });

    it('starts a January 2 YTD chart on the 1 January point in any timezone', () => {
        const now = new Date(2026, 0, 2, 12, 0, 0, 0).getTime();
        const historyDaily = [
            [Date.UTC(2025, 11, 31), 1],
            [Date.UTC(2026, 0, 1), 2],
            [Date.UTC(2026, 0, 2), 3],
        ].filter(([timestamp]) => timestamp < now);
        historyDaily.push([now, 4]);
        const result = priceHistoryForRange({ historyDaily }, range('ytd'), now);

        expect(result).toHaveLength(range('ytd').points);
        expect(result[0]).toBe(2);
        expect(result.at(-1)).toBe(4);
    });

    it('uses hourly tails and each daily range window without changing endpoints', () => {
        const historyDaily = dailyHistory();
        const entry = { sparkline: SPARKLINE, historyDaily };
        const dayPrices = (id) => historyDaily
            .filter(([timestamp]) => timestamp >= rangeWindowStart(id, NOW))
            .map(([, price]) => price);

        expect(priceHistoryForRange(entry, range('24h'), NOW)).toEqual(SPARKLINE.slice(-24));
        expect(priceHistoryForRange(entry, range('1w'), NOW)).toEqual(SPARKLINE);
        for (const id of ['1m', '3m', '6m', '1y', 'ytd', 'all']) {
            const expected = dayPrices(id);
            const result = priceHistoryForRange(entry, range(id), NOW);
            expect(result, id).toHaveLength(range(id).points);
            expect(result[0], id).toBe(expected[0]);
            expect(result.at(-1), id).toBe(expected.at(-1));
        }
    });

    it('needs two daily points and never lets daily history affect an hourly range', () => {
        expect(priceHistoryForRange({ historyDaily: null }, range('1m'), NOW)).toBeNull();
        expect(priceHistoryForRange({ historyDaily: [] }, range('1m'), NOW)).toBeNull();
        expect(priceHistoryForRange({ historyDaily: [[NOW, 2]] }, range('1m'), NOW)).toBeNull();
        const hourly = priceHistoryForRange(
            { sparkline: [1, 2], historyDaily: [[NOW, 99]] },
            range('24h'),
            NOW,
        );
        expect(hourly).toHaveLength(24);
        expect(hourly[0]).toBe(1);
        expect(hourly.at(-1)).toBe(2);
        expect(hourly).not.toContain(99);
    });
});

describe('lazy daily history in price charts', () => {
    it('loads Home daily history once, reuses it for another daily range, and draws', async () => {
        const history = deferred();
        const messaging = {
            getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
            getNativePricesRequest: vi.fn((request) => request.includeHistory
                ? history.promise
                : Promise.resolve({ prices: { [CHAIN_ID]: baseEntry() } })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PortfolioChart rows={ROWS} walletId="real-wallet" />
            </MessagingProvider>,
        );
        await screen.findByRole('img', { name: /Range 1W/ });

        fireEvent.click(screen.getByRole('tab', { name: '1M' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Loading price history');
        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: [CHAIN_ID], includeHistory: true, fiatCurrency: 'USD',
        });

        await act(async () => history.resolve({
            prices: { [CHAIN_ID]: { historyDaily: dailyHistory() } },
        }));
        expect(await screen.findByRole('img', { name: /Range 1M/ })).toBeInTheDocument();
        expect(screen.queryByText(/No price history/)).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: '3M' }));
        expect(await screen.findByRole('img', { name: /Range 3M/ })).toBeInTheDocument();
        expect(messaging.getNativePricesRequest.mock.calls.filter(([request]) => request.includeHistory)).toHaveLength(1);
    });

    it('shows the Home empty state when daily history is unavailable', async () => {
        const messaging = {
            getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
            getNativePricesRequest: vi.fn(async (request) => ({
                prices: { [CHAIN_ID]: request.includeHistory ? { historyDaily: null } : baseEntry() },
            })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PortfolioChart rows={ROWS} walletId="real-wallet" />
            </MessagingProvider>,
        );
        await screen.findByRole('img', { name: /Range 1W/ });
        fireEvent.click(screen.getByRole('tab', { name: '1M' }));
        expect(await screen.findByText(/No price history/)).toBeInTheDocument();
    });

    it('keeps demo history offline', async () => {
        markDemoWallet('demo-wallet');
        const messaging = {
            getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
            getNativePricesRequest: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PortfolioChart rows={ROWS} walletId="demo-wallet" />
            </MessagingProvider>,
        );
        expect(await screen.findByRole('img', { name: /Range 1W/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: '1Y' }));
        await screen.findByRole('img', { name: /Range 1Y/ });
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });

    it('requests Token Detail daily history for a real native coin and draws it', async () => {
        const messaging = {
            getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
            getNativePricesRequest: vi.fn(async (request) => ({
                prices: { [CHAIN_ID]: request.includeHistory
                    ? { historyDaily: dailyHistory() }
                    : baseEntry() },
            })),
            getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [] })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="real-wallet" chainId={CHAIN_ID} tick="BTC" kind="native" quantity="1" divisibility={8} onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByLabelText('1W price chart');
        fireEvent.click(screen.getByRole('tab', { name: '1Y' }));

        expect(await screen.findByLabelText('1Y price chart')).toBeInTheDocument();
        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: [CHAIN_ID], includeSparkline: false, includeHistory: true, fiatCurrency: 'USD',
        });
    });

    it('keeps a real non-native token empty without requesting native history', async () => {
        const messaging = {
            getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
            getNativePricesRequest: vi.fn(),
            getTokenInfo: vi.fn(async () => ({ creator: 'bc1qissuer', marketPrice: '0.5' })),
            getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [] })),
            getHoldersForToken: vi.fn(async () => ({ data: [] })),
            listGatedContent: vi.fn(async () => []),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="real-wallet" chainId={CHAIN_ID} tick="XCP" kind="token" quantity="1" onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(await screen.findByText('No price history yet')).toBeInTheDocument();
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });
});

describe('range labels', () => {
    it('renders labels as written and does not uppercase them in CSS', async () => {
        markDemoWallet('demo-wallet');
        const messaging = { getSettings: vi.fn(async () => ({})), getNativePricesRequest: vi.fn() };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PortfolioChart rows={ROWS} walletId="demo-wallet" />
            </MessagingProvider>,
        );
        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['24h', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'All']);

        const css = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/PortfolioChart.module.css',
        ), 'utf8');
        const rangeRule = css.match(/\.range\s*\{([^}]*)\}/)?.[1] || '';
        expect(rangeRule).not.toMatch(/text-transform\s*:\s*uppercase/);
    });
});
