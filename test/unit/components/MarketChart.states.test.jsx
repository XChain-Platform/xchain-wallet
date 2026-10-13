// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const reducedMotionHarness = vi.hoisted(() => ({ value: false }));
const chartHarness = vi.hoisted(() => {
    const setData = vi.fn();
    const fitContent = vi.fn();
    const remove = vi.fn();
    const chartApplyOptions = vi.fn();
    const seriesApplyOptions = vi.fn();
    const addLineSeries = vi.fn(() => ({ setData, applyOptions: seriesApplyOptions }));
    return {
        setData,
        fitContent,
        remove,
        chartApplyOptions,
        seriesApplyOptions,
        addLineSeries,
        createChart: vi.fn(() => ({
            addLineSeries,
            timeScale: () => ({ fitContent }),
            applyOptions: chartApplyOptions,
            remove,
        })),
    };
});

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => ({
    ...(await importOriginal()),
    useReducedMotion: () => reducedMotionHarness.value,
}));
vi.mock('lightweight-charts', () => ({ createChart: chartHarness.createChart }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketChart } from '../../../packages/core/src/shared/components/MarketChart.jsx';

afterEach(() => {
    cleanup();
    reducedMotionHarness.value = false;
    document.documentElement.removeAttribute('data-xc-theme');
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

    it('colors a falling series from the danger token and keeps flat data neutral', async () => {
        const computedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            color: 'rgb(1, 2, 3)',
            getPropertyValue: (name) => ({
                '--xc-text': '#111111',
                '--xc-text-muted': '#777777',
                '--xc-border': '#222222',
                '--xc-accent-primary': '#333333',
                '--xc-success': '#00aa00',
                '--xc-danger': '#cc0000',
            }[name] || ''),
        });
        renderChart(vi.fn().mockResolvedValue([
            { price: '0.02', amount: '10', type: 'buy', timestamp: 60 },
            { price: '0.01', amount: '20', type: 'sell', timestamp: 3660 },
        ]));

        await waitFor(() => {
            expect(chartHarness.seriesApplyOptions).toHaveBeenCalledWith({ color: '#cc0000' });
        });
        expect(chartHarness.createChart.mock.calls.at(-1)[1]).toMatchObject({
            layout: { textColor: '#111111' },
            grid: {
                horzLines: { color: '#777777' },
                vertLines: { color: '#777777' },
            },
            rightPriceScale: { borderColor: '#222222' },
            timeScale: { borderColor: '#222222' },
        });
        expect(chartHarness.addLineSeries.mock.calls.at(-1)[0].priceFormat.formatter(0.125))
            .toBe('0.125 BTC');

        cleanup();
        renderChart(vi.fn().mockResolvedValue([
            { price: '0.01', amount: '10', type: 'buy', timestamp: 60 },
            { price: '0.01', amount: '20', type: 'sell', timestamp: 3660 },
        ]));
        await waitFor(() => {
            expect(chartHarness.seriesApplyOptions).toHaveBeenLastCalledWith({ color: '#333333' });
        });
        computedStyle.mockRestore();
    });

    it('re-reads label, grid, crosshair, and series tokens when the theme changes', async () => {
        let dark = false;
        const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
            color: dark ? '#e5eaf2' : '#0f172a',
            getPropertyValue: (name) => (dark ? {
                '--xc-text': '#e5eaf2',
                '--xc-text-muted': '#94a3b8',
                '--xc-border': '#243044',
                '--xc-accent-primary': '#1a7bac',
                '--xc-success': '#4ade80',
                '--xc-danger': '#dc2626',
            } : {
                '--xc-text': '#0f172a',
                '--xc-text-muted': '#5f7086',
                '--xc-border': '#e4e7eb',
                '--xc-accent-primary': '#1a7bac',
                '--xc-success': '#146f34',
                '--xc-danger': '#dc2626',
            })[name] || '',
        }));
        renderChart(vi.fn().mockResolvedValue([
            { price: '0.01', amount: '10', type: 'buy', timestamp: 60 },
            { price: '0.02', amount: '20', type: 'sell', timestamp: 3660 },
        ]));

        await waitFor(() => {
            expect(chartHarness.seriesApplyOptions).toHaveBeenCalledWith({ color: '#146f34' });
        });
        dark = true;
        act(() => document.documentElement.setAttribute('data-xc-theme', 'dark'));

        await waitFor(() => {
            expect(chartHarness.chartApplyOptions).toHaveBeenCalledWith({
                layout: { background: { color: 'transparent' }, textColor: '#e5eaf2' },
                grid: {
                    horzLines: { color: '#94a3b8' },
                    vertLines: { color: '#94a3b8' },
                },
                rightPriceScale: { borderColor: '#243044' },
                timeScale: { borderColor: '#243044' },
                crosshair: {
                    vertLine: { color: '#94a3b8' },
                    horzLine: { color: '#94a3b8' },
                },
            });
            expect(chartHarness.seriesApplyOptions).toHaveBeenCalledWith({ color: '#4ade80' });
        });
        computedStyle.mockRestore();
    });

    it('resizes the canvas with its container and disables momentum for reduced motion', async () => {
        reducedMotionHarness.value = true;
        renderChart(vi.fn().mockResolvedValue([]));
        await waitFor(() => {
            expect(chartHarness.createChart.mock.calls.at(-1)[1].kineticScroll)
                .toEqual({ mouse: false, touch: false });
        });

        const container = screen.getByRole('img');
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width: 288.9 });
        act(() => window.dispatchEvent(new Event('resize')));
        expect(chartHarness.chartApplyOptions).toHaveBeenCalledWith({ width: 288 });
    });

    it('surfaces a history failure without also showing the empty state', async () => {
        renderChart(vi.fn().mockRejectedValue(new Error('network unavailable')));

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the price chart.");
        expect(screen.queryByText('No trades yet in this market.')).toBeNull();
        expect(screen.queryByText('Loading price chart…')).toBeNull();
    });
});
