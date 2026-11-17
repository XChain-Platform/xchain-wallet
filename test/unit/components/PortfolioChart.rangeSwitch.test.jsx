// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Switching the portfolio chart's range keeps the line already drawn on the
// card until the new range's series is ready, and never asks again for a
// series the chart already holds: 24h and 1W read the hourly week, every
// longer range the daily year, each requested once.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const DAY_MS = 86_400_000;
const SPARKLINE = Array.from({ length: 168 }, (_, index) => 70_000 + index);
const ROWS = [{
    kind: 'native', chainId: CHAIN_ID, tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80_000,
}];

function dailyHistory(days = 400) {
    const now = Date.now();
    const points = [];
    for (let ago = days; ago >= 1; ago -= 1) points.push([now - ago * DAY_MS, 60_000 + (days - ago)]);
    points.push([now, 60_000 + days]);
    return points;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function historyCalls(messaging) {
    return messaging.getNativePricesRequest.mock.calls.filter(([request]) => request.includeHistory);
}

function hourlyCalls(messaging) {
    return messaging.getNativePricesRequest.mock.calls.filter(([request]) => !request.includeHistory);
}

function mount(historyResponse, chartProps = {}, sparkline = SPARKLINE) {
    const messaging = {
        getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
        getNativePricesRequest: vi.fn((request) => (request.includeHistory
            ? historyResponse()
            : Promise.resolve({ prices: { [CHAIN_ID]: { priceFiat: 80_000, sparkline } } }))),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PortfolioChart rows={ROWS} walletId="real-wallet" {...chartProps} />
        </MessagingProvider>,
    );
    return messaging;
}

function pick(label) {
    fireEvent.click(screen.getByRole('tab', { name: label }));
}

function drawnLine() {
    return document.querySelector('[data-chart-line]');
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
afterEach(() => cleanup());

describe('PortfolioChart range switching', () => {
    it('shows five matching labels and guides on a non-flat hero chart', async () => {
        mount(async () => ({ prices: {} }), { behind: true });

        const chart = await screen.findByRole('img', { name: /Range high .*, low .*/ });
        const labels = [...chart.parentElement.querySelectorAll('[data-chart-scale]')];
        const guides = [...chart.parentElement.querySelectorAll('[data-chart-guide]')];
        expect(labels).toHaveLength(5);
        expect(guides).toHaveLength(labels.length);
        expect(labels[0].parentElement).toHaveAttribute('data-chart-scale-band', 'hero');
        expect(guides[0].ownerSVGElement).toHaveAttribute('data-chart-scale-band', 'hero');
    });

    it('uses a 2px directional line and matching 22 percent gradient', async () => {
        mount(async () => ({ prices: {} }), { behind: true });
        const up = await screen.findByRole('img', { name: /Range high .*, low .*/ });
        const upLines = [...up.parentElement.querySelectorAll('polyline[data-chart-tone="up"]')];
        const upGradient = up.querySelector('linearGradient[data-chart-fill-tone="up"]');
        expect(upLines).not.toHaveLength(0);
        expect(upLines.every((line) => line.getAttribute('stroke') === 'var(--xc-hero-chart-up)')).toBe(true);
        expect(upLines.every((line) => line.getAttribute('stroke-width') === '2')).toBe(true);
        expect(upGradient.querySelector('stop').getAttribute('stop-opacity')).toBe('var(--xc-hero-chart-fill-opacity)');
        expect([...upGradient.querySelectorAll('stop')].every((stop) => stop.getAttribute('stop-color') === 'var(--xc-hero-chart-up)')).toBe(true);

        cleanup();
        mount(async () => ({ prices: {} }), { behind: true }, [...SPARKLINE].reverse());
        const down = await screen.findByRole('img', { name: /Range high .*, low .*/ });
        const downLines = [...down.parentElement.querySelectorAll('polyline[data-chart-tone="down"]')];
        const downGradient = down.querySelector('linearGradient[data-chart-fill-tone="down"]');
        expect(downLines).not.toHaveLength(0);
        expect(downLines.every((line) => line.getAttribute('stroke') === 'var(--xc-hero-chart-down)')).toBe(true);
        expect([...downGradient.querySelectorAll('stop')].every((stop) => stop.getAttribute('stop-color') === 'var(--xc-hero-chart-down)')).toBe(true);
    });

    it('labels the portfolio range in the selected coin unit', async () => {
        mount(async () => ({ prices: {} }), {
            behind: true,
            unit: { tick: 'BTC', chainId: CHAIN_ID, price: 80_000 },
        });

        const chart = await screen.findByRole('img', { name: /Range high .* BTC, low .* BTC/ });
        const labels = [...chart.parentElement.querySelectorAll('[data-chart-scale]')];
        // A BTC-only portfolio is flat when measured in BTC, so the scale
        // correctly collapses while retaining the selected unit.
        expect(labels).toHaveLength(1);
        expect(labels.every((label) => label.textContent.endsWith(' BTC'))).toBe(true);
    });

    it('keeps the drawn line while a daily range loads, then draws the new range', async () => {
        const history = deferred();
        mount(() => history.promise);
        await screen.findByRole('img', { name: /Range 1W/ });

        pick('1Y');
        // The 1W line stays on the card; the loading word is for screen readers only.
        expect(screen.getByRole('img', { name: /Range 1W/ })).toBeInTheDocument();
        expect(drawnLine()).toHaveAttribute('data-chart-line', 'held');
        expect(screen.getByRole('status')).toHaveTextContent('Loading price history');
        expect(screen.getByRole('status')).toHaveClass('sr-only');
        expect(screen.getByRole('region', { name: 'Portfolio performance' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByText(/No price history/)).toBeNull();

        await act(async () => history.resolve({ prices: { [CHAIN_ID]: { historyDaily: dailyHistory() } } }));
        expect(await screen.findByRole('img', { name: /Range 1Y/ })).toBeInTheDocument();
        expect(drawnLine()).toHaveAttribute('data-chart-line', 'current');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('cycles every range and back to 24h with one daily request and no hourly refetch', async () => {
        const messaging = mount(async () => ({ prices: { [CHAIN_ID]: { historyDaily: dailyHistory() } } }));
        await screen.findByRole('img', { name: /Range 1W/ });
        const hourlyAtStart = hourlyCalls(messaging).length;

        for (const label of ['1M', '3M', '6M', '1Y', 'YTD', 'All']) {
            pick(label);
            expect(await screen.findByRole('img', { name: new RegExp(`Range ${label}`) })).toBeInTheDocument();
        }
        pick('24h');
        // 24h draws at once from the held hourly week, with nothing loading.
        expect(screen.getByRole('img', { name: /Range 24h/ })).toBeInTheDocument();
        expect(screen.queryByRole('status')).toBeNull();
        pick('1Y');
        expect(screen.getByRole('img', { name: /Range 1Y/ })).toBeInTheDocument();
        expect(screen.queryByRole('status')).toBeNull();
        pick('24h');
        expect(screen.getByRole('img', { name: /Range 24h/ })).toBeInTheDocument();

        await act(async () => { await Promise.resolve(); });
        expect(historyCalls(messaging)).toHaveLength(1);
        expect(hourlyCalls(messaging)).toHaveLength(hourlyAtStart);
    });

    it('lets a daily request finish after a switch back to 24h and reuses it', async () => {
        const history = deferred();
        const messaging = mount(() => history.promise);
        await screen.findByRole('img', { name: /Range 1W/ });

        pick('1Y');
        pick('24h');
        expect(screen.getByRole('img', { name: /Range 24h/ })).toBeInTheDocument();
        await act(async () => history.resolve({ prices: { [CHAIN_ID]: { historyDaily: dailyHistory() } } }));

        pick('3M');
        expect(await screen.findByRole('img', { name: /Range 3M/ })).toBeInTheDocument();
        expect(screen.queryByRole('status')).toBeNull();
        expect(historyCalls(messaging)).toHaveLength(1);
    });

    it('stops showing the held line once a daily load ends with no history', async () => {
        mount(async () => ({ prices: { [CHAIN_ID]: { historyDaily: null } } }));
        await screen.findByRole('img', { name: /Range 1W/ });

        pick('1M');
        expect(await screen.findByText(/No price history/)).toBeInTheDocument();
        expect(drawnLine()).toBeNull();
    });
});
