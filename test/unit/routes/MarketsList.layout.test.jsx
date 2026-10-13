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

    it('debounces case-insensitive ticker and name search, clears it, and opens the result from the keyboard', async () => {
        const onOpenMarket = vi.fn();
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'BTC', tick2: 'PEPE', tick2_name: 'Pepe Collectible', depth: 9 },
                { tick1: 'BTC', tick2: 'XCP', tick2_name: 'Counterparty', depth: 8 },
            ]),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={onOpenMarket}
                />
            </MessagingProvider>,
        );

        const search = await screen.findByRole('searchbox', { name: 'Search markets' });
        await screen.findByText('Counterparty');
        fireEvent.change(search, { target: { value: 'pepe collectible' } });
        expect(screen.getByText('Counterparty')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Counterparty')).toBeNull());
        expect(screen.getByText('PEPE')).toBeInTheDocument();

        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'BTC', 'PEPE');

        fireEvent.change(search, { target: { value: 'absent' } });
        expect(await screen.findByText('No matches')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear market search' }));
        expect(search).toHaveValue('');
        expect(screen.getByText('Counterparty')).toBeInTheDocument();
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
        expect(await screen.findByText('No matches')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(search).toHaveValue('');
        expect(await screen.findByText('TOKEN0')).toBeInTheDocument();
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
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(25));
        expect(screen.getByText('25 of 5,000 markets shown')).toBeInTheDocument();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 241;
        const showMore = screen.getByRole('button', { name: 'Load more markets' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(50));
        expect(scroller.scrollTop).toBe(241);
    });
});
