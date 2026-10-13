// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

afterEach(() => cleanup());

describe('MarketsList narrow layout', () => {
    it('matches market-row height and marks the results region busy on first load', () => {
        const messaging = {
            getMarkets: vi.fn(() => new Promise(() => {})),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        const region = screen.getByRole('region', { name: 'Markets results' });
        expect(region).toHaveAttribute('aria-busy', 'true');
        const skeletonRows = screen.getByRole('status', { name: 'Loading markets' })
            .querySelectorAll('[style*="height: 60px"]');
        expect(skeletonRows).toHaveLength(5);
    });

    it('keeps cached rows visible instead of showing a skeleton during refresh', async () => {
        const refresh = new Promise(() => {});
        const messaging = {
            getMarkets: vi.fn()
                .mockResolvedValueOnce([{ tick1: 'BTC', tick2: 'AAA', depth: 1 }])
                .mockImplementationOnce(() => refresh),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );
        await screen.findByText('AAA');

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.getMarkets).toHaveBeenCalledTimes(2));
        expect(screen.getByText('AAA')).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Loading markets' })).toBeNull();
        expect(screen.getByRole('region', { name: 'Markets results' }))
            .toHaveAttribute('aria-busy', 'true');
    });

    it('allows the search and multi-button filter toolbar to wrap', async () => {
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        const search = await screen.findByLabelText('Search markets');
        expect(search.parentElement.style.flexWrap).toBe('wrap');
        expect(search.style.flex).toBe('1 1 140px');
    });

    it('shows a load error instead of presenting a failed request as an empty market', async () => {
        const messaging = {
            getMarkets: vi.fn().mockRejectedValue(new Error('internal transport detail')),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Could not load markets. Try again.')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('internal transport detail');
    });

    it('the All tab lists every market while the default Popular tab lists the top five', async () => {
        const rows = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'].map((t, i) => ({
            tick1: 'BTC', tick2: t, depth: 10 - i,
        }));
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue(rows),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        await screen.findByText('AAA');
        expect(screen.queryByText('FFF')).toBeNull();
        const all = screen.getByRole('tab', { name: 'All' });
        expect(all).toHaveAttribute('aria-selected', 'false');
        fireEvent.click(all);
        expect(all).toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByText('FFF')).toBeInTheDocument();
    });
});
