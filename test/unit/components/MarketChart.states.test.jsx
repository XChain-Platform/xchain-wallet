// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const chartHarness = vi.hoisted(() => {
    const setData = vi.fn();
    const fitContent = vi.fn();
    const remove = vi.fn();
    return {
        setData,
        fitContent,
        remove,
        createChart: vi.fn(() => ({
            addLineSeries: () => ({ setData }),
            timeScale: () => ({ fitContent }),
            remove,
        })),
    };
});

vi.mock('lightweight-charts', () => ({ createChart: chartHarness.createChart }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketChart } from '../../../packages/core/src/shared/components/MarketChart.jsx';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function renderChart(getMarketHistory) {
    return render(
        <MessagingProvider shell="web" messaging={{ getMarketHistory }}>
            <MarketChart chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />
        </MessagingProvider>,
    );
}

describe('MarketChart states and timeframes', () => {
    it('does not report an empty market while history is loading', async () => {
        const request = deferred();
        renderChart(vi.fn(() => request.promise));

        expect(screen.getByRole('status')).toHaveTextContent('Loading price chart…');
        expect(screen.queryByText('No trades yet in this market.')).toBeNull();
        expect(screen.getByRole('img').parentElement).toHaveAttribute('aria-busy', 'true');

        await act(async () => request.resolve([]));

        expect(await screen.findByText('No trades yet in this market.')).toBeInTheDocument();
        expect(screen.queryByText('Loading price chart…')).toBeNull();
    });

    it('offers every supported timeframe and rebuckets the loaded history', async () => {
        renderChart(vi.fn().mockResolvedValue([
            { price: '0.01', amount: '10', type: 'buy', timestamp: 60 },
            { price: '0.02', amount: '20', type: 'sell', timestamp: 120 },
        ]));

        const timeframe = screen.getByRole('combobox', { name: 'Chart timeframe' });
        expect(Array.from(timeframe.options, (option) => option.value)).toEqual([
            '1m', '5m', '15m', '1h', '4h', '1d', '1w', '30d', '60d', '90d',
        ]);

        await waitFor(() => {
            expect(chartHarness.setData).toHaveBeenCalledWith([
                { time: 0, value: 0.02 },
            ]);
        });

        fireEvent.change(timeframe, { target: { value: '1m' } });
        await waitFor(() => {
            expect(chartHarness.setData).toHaveBeenLastCalledWith([
                { time: 60, value: 0.01 },
                { time: 120, value: 0.02 },
            ]);
        });
        expect(screen.getByRole('img')).toHaveAccessibleName(
            'XCHAIN/BTC price chart. Range 1m. Values range from 0.01 BTC to 0.02 BTC. Start 0.01 BTC. End 0.02 BTC. Change +0.01 BTC (+100.00%).',
        );
    });

    it('surfaces a history failure without also showing the empty state', async () => {
        renderChart(vi.fn().mockRejectedValue(new Error('network unavailable')));

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the price chart.");
        expect(screen.queryByText('No trades yet in this market.')).toBeNull();
        expect(screen.queryByText('Loading price chart…')).toBeNull();
    });
});
