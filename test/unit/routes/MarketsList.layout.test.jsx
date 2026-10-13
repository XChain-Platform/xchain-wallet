// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';

afterEach(() => cleanup());

describe('MarketsList narrow layout', () => {
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
        const popular = screen.getByRole('tab', { name: 'Popular' });
        const all = screen.getByRole('tab', { name: 'All' });
        const panel = screen.getByRole('tabpanel', { name: 'Popular' });
        expect(popular).toHaveAttribute('tabindex', '0');
        expect(popular).toHaveAttribute('aria-controls', panel.id);
        expect(panel).toHaveAttribute('aria-labelledby', popular.id);
        expect(all).toHaveAttribute('tabindex', '-1');
        expect(all).toHaveAttribute('aria-selected', 'false');
        fireEvent.click(all);
        expect(all).toHaveAttribute('aria-selected', 'true');
        expect(all).toHaveAttribute('tabindex', '0');
        expect(popular).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('tabpanel', { name: 'All' })).toBe(panel);
        expect(panel).toHaveAttribute('aria-labelledby', all.id);
        expect(await screen.findByText('FFF')).toBeInTheDocument();
    });

    it('resets filters from an empty search and loads long lists in pages', async () => {
        const rows = Array.from({ length: 30 }, (_, index) => ({
            tick1: 'BTC', tick2: `TOKEN${index}`, depth: 30 - index,
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

        await screen.findByText('TOKEN0');
        fireEvent.click(screen.getByRole('tab', { name: 'All' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(25);
        fireEvent.click(screen.getByRole('button', { name: 'Load more markets' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(30);

        const search = screen.getByRole('searchbox', { name: 'Search markets' });
        fireEvent.change(search, { target: { value: 'missing' } });
        expect(screen.getByText('No matches')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(search).toHaveValue('');
        expect(screen.getByText('TOKEN0')).toBeInTheDocument();
    });

    it('shows a loading skeleton and retries a failed marketplace activity request', async () => {
        const getDispensersForToken = vi.fn()
            .mockRejectedValueOnce(new Error('service unavailable'))
            .mockResolvedValue({ data: [] });
        const messaging = {
            getDispensersForToken,
            getDispenses: vi.fn().mockResolvedValue({ data: [] }),
            getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
            getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketActivity walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(screen.getByRole('status', { name: 'Loading marketplace activity' }))
            .toBeInTheDocument();
        expect(await screen.findByText('Some marketplace activity could not be loaded.'))
            .toBeInTheDocument();
        expect(screen.queryByText('No open dispensers')).toBeNull();
        const callsBeforeRetry = getDispensersForToken.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(getDispensersForToken.mock.calls.length)
            .toBeGreaterThan(callsBeforeRetry));
        await waitFor(() => expect(screen.queryByText('Some marketplace activity could not be loaded.'))
            .toBeNull());
    });
});
