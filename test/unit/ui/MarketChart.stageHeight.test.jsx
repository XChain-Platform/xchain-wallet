// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The market chart card keeps one height through every state: loading,
// empty, error, data and an unavailable chart runtime all draw inside the
// same fixed-height stage under the same timeframe header, so the panel
// below the chart never jumps as history loads or fails.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const chartHarness = vi.hoisted(() => {
    const harness = { fail: false };
    harness.createChart = vi.fn(() => {
        if (harness.fail) throw new Error('chart runtime unavailable');
        return {
            addLineSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
            timeScale: () => ({ fitContent: () => {} }),
            applyOptions: () => {},
            remove: () => {},
        };
    });
    return harness;
});

vi.mock('lightweight-charts', () => ({ createChart: chartHarness.createChart }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketChart } from '../../../packages/core/src/shared/components/MarketChart.jsx';

afterEach(() => {
    cleanup();
    chartHarness.fail = false;
    vi.restoreAllMocks();
});

function renderChart(getMarketHistory) {
    return render(
        <MessagingProvider shell="web" messaging={{ getMarketHistory }}>
            <MarketChart chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />
        </MessagingProvider>,
    );
}

// The card is the stage's parent; it holds the header row and the stage
// and nothing else, so no state adds height below the stage.
function readLayout(container) {
    const stage = container.querySelector('[data-chart-stage]');
    expect(stage, 'chart stage').not.toBeNull();
    const card = stage.parentElement;
    return {
        stage,
        height: stage.style.height,
        cardChildren: card.children.length,
        hasHeader: Boolean(card.querySelector('select[aria-label="Chart timeframe"]')),
    };
}

// Each render waits for its chart runtime to start (or fail) before the next
// one, so every render resolves the mocked runtime.
async function chartSettled(calls) {
    await waitFor(() => expect(chartHarness.createChart).toHaveBeenCalledTimes(calls));
}

describe('MarketChart fixed-height stage', () => {
    it('keeps the same stage height and card shape in every state', async () => {
        const layouts = {};

        // Loading: the request never settles.
        let view = renderChart(vi.fn(() => new Promise(() => {})));
        await chartSettled(1);
        const loading = screen.getByRole('status', { name: 'Loading price chart' });
        layouts.loading = readLayout(view.container);
        expect(layouts.loading.stage.contains(loading)).toBe(true);
        cleanup();

        // Empty: the market has no trades.
        view = renderChart(vi.fn().mockResolvedValue([]));
        await chartSettled(2);
        const empty = await screen.findByText('No trades yet in this market.');
        layouts.empty = readLayout(view.container);
        expect(layouts.empty.stage.contains(empty)).toBe(true);
        cleanup();

        // Error: the history request fails.
        view = renderChart(vi.fn().mockRejectedValue(new Error('network unavailable')));
        await chartSettled(3);
        const alert = await screen.findByRole('alert');
        layouts.error = readLayout(view.container);
        expect(layouts.error.stage.contains(alert)).toBe(true);
        cleanup();

        // Data: the chart draws two fills.
        view = renderChart(vi.fn().mockResolvedValue([
            { price: '0.01', amount: '10', type: 'buy', timestamp: 60 },
            { price: '0.02', amount: '20', type: 'sell', timestamp: 3660 },
        ]));
        await chartSettled(4);
        await waitFor(() => {
            expect(screen.queryByRole('status', { name: 'Loading price chart' })).toBeNull();
        });
        layouts.data = readLayout(view.container);
        expect(layouts.data.stage.contains(screen.getByRole('img'))).toBe(true);
        cleanup();

        // Unavailable: the chart runtime fails to start.
        chartHarness.fail = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        view = renderChart(vi.fn().mockResolvedValue([]));
        const unavailable = await screen.findByText('The price chart is unavailable right now.');
        await act(async () => { await Promise.resolve(); });
        layouts.unavailable = readLayout(view.container);
        expect(layouts.unavailable.stage.contains(unavailable)).toBe(true);

        for (const [state, layout] of Object.entries(layouts)) {
            expect(layout.height, state).toBe('120px');
            expect(layout.cardChildren, state).toBe(2);
            expect(layout.hasHeader, state).toBe(true);
        }
    });
});
