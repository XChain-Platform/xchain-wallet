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

    it('bounds a market response with thousands of rows and expands in place', async () => {
        const rows = Array.from({ length: 5_000 }, (_, index) => ({
            tick1: 'BTC',
            tick2: `TOKEN${String(index).padStart(4, '0')}`,
            depth: index,
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

        fireEvent.click(await screen.findByRole('tab', { name: 'All' }));
        const list = (await screen.findByText('TOKEN0000')).closest('ul');
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(100));
        expect(screen.getByText('100 of 5,000 markets shown')).toBeInTheDocument();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 241;
        const showMore = screen.getByRole('button', { name: 'Show more markets' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(200));
        expect(scroller.scrollTop).toBe(241);
    });
});
