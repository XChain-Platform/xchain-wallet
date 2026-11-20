// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { selectOption } from '../../helpers/selectOption.js';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';
import { userEvent } from '../../helpers/userEvent.js';
import marketsStyles from '../../../packages/core/src/shared/routes/MarketsList.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { readFileSync } from 'node:fs';
import { useFakeTimeouts } from '../../helpers/fakeTimeouts.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

// The Show list (Popular, All, Watchlist) and search sit in the title-line filter.
function openFilter() {
    const trigger = screen.getByRole('button', { name: 'Filter markets' });
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
}

function chooseShow(value) {
    openFilter();
    selectOption(screen.getByLabelText('Show markets'), value);
}

describe('MarketsList narrow layout', () => {
    it('names the selected chain without its network kind', async () => {
        render(
            <MessagingProvider shell="web" messaging={{
                getMarkets: vi.fn().mockResolvedValue([]),
                listWatchlistForWallet: vi.fn().mockResolvedValue([]),
            }}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-regtest', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        await screen.findByText('No markets for BTC');
        const selector = screen.getByRole('button', { name: /Change asset/ });
        // The selector card names the chain (coordinator ruling) but never
        // the network kind.
        expect(selector).toHaveTextContent('Bitcoin');
        expect(selector).toHaveClass(buttonStyles.rowAction);
        expect(selector).not.toHaveClass(buttonStyles.primary);
        expect(selector.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        const css = readFileSync('packages/core/src/shared/routes/MarketsList.module.css', 'utf8');
        expect(css).toMatch(/\.assetCard\.assetCard:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\);[^}]*border-color:\s*var\(--xc-border\);/s);
    });

    it('reaches and activates market actions in their visual order', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onChangeAsset = vi.fn();
        const onOpenMarket = vi.fn();
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'BTC', tick2: 'PEPE', tick2_name: 'Pepe', depth: 9 },
            ]),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
            saveWatchlistEntry: vi.fn().mockResolvedValue({}),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onBack={onBack}
                    onChangeAsset={onChangeAsset}
                    onOpenMarket={onOpenMarket}
                />
            </MessagingProvider>,
        );

        const open = await screen.findByRole('button', { name: 'Open Pepe market' });
        // The row names the token alone; the picker above names the quote coin.
        expect(open).toHaveTextContent('PEPE');
        expect(open.textContent).not.toMatch(/\/\s*BTC|BTC\s*\//);
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        back.focus();
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        // The title-line filter follows Back; opening it puts the caret in the
        // search box, where Enter opens the top market and Escape closes it.
        await user.tab();
        expect(screen.getByRole('button', { name: 'Filter markets' })).toHaveFocus();
        await user.keyboard('{Enter}');
        const search = screen.getByRole('searchbox', { name: 'Search markets' });
        expect(search).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'BTC', 'PEPE');
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('searchbox', { name: 'Search markets' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Filter markets' })).toHaveFocus();

        await user.tab();
        expect(screen.getByRole('button', { name: /Change asset/ })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onChangeAsset).toHaveBeenCalledOnce();

        // No star sits in the row: the market button follows the selector.
        await user.tab();
        expect(screen.getByRole('button', { name: 'Open Pepe market' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onOpenMarket).toHaveBeenCalledTimes(2);
    });

    it('shortens a long token name with an ellipsis and keeps the full name as its title', async () => {
        const longTick = 'A'.repeat(120);
        render(
            <MessagingProvider shell="web" messaging={{
                getMarkets: vi.fn().mockResolvedValue([{ tick1: longTick, tick2: 'BTC', depth: 3 }]),
                getDispensersForToken: vi.fn().mockResolvedValue([]),
                listWatchlistForWallet: vi.fn().mockResolvedValue([]),
            }}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        const name = await screen.findByText(longTick);
        expect(name).toHaveClass(marketsStyles.marketName);
        expect(name).toHaveAttribute('title', longTick);
        const css = readFileSync('packages/core/src/shared/routes/MarketsList.module.css', 'utf8');
        expect(css).toMatch(/\.marketName\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/s);
        expect(css).toMatch(/\.marketContent\s*\{[^}]*min-width:\s*0/s);
        // The muted order-count line ("3 orders") sits under the name and stays on one line.
        expect(screen.getByText('3 orders')).toHaveClass(marketsStyles.marketDepth);
        expect(css).toMatch(/\.marketDepth\s*\{[^}]*white-space:\s*nowrap/s);
        // The figures slot is not capped at half the row, so at larger text the
        // figures stay inside the row padding and the name gives way.
        expect(css).toMatch(/\.marketButton \.marketTrailing\s*\{[^}]*max-width:\s*none/s);
    });

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
        const notice = screen.getByRole('status');
        expect(notice).toHaveTextContent('Loading markets');
        expect(notice.parentElement.firstElementChild).toBe(notice);
        const skeletonRows = region.querySelectorAll('[style*="height: 60px"]');
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

    it('keeps search and the Show list behind the title-line filter, not in the page body', async () => {
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

        const filter = await screen.findByRole('button', { name: 'Filter markets' });
        // Closed, the page body carries neither the search box nor the Show list.
        expect(screen.queryByRole('searchbox', { name: 'Search markets' })).toBeNull();
        expect(screen.queryByLabelText('Show markets')).toBeNull();
        fireEvent.click(filter);
        const panel = screen.getByRole('dialog', { name: 'Filter markets' });
        expect(within(panel).getByRole('searchbox', { name: 'Search markets' })).toBeInTheDocument();
        expect(within(panel).getByLabelText('Show markets')).toBeInTheDocument();
    });

    it('shows the plain empty state, with no page error or transport detail, when the request fails (G91)', async () => {
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

        expect(await screen.findByText('No markets for BTC')).toBeInTheDocument();
        expect(screen.queryByText('Could not load markets. Try again.')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
        expect(document.body.textContent).not.toContain('internal transport detail');
    });

    it('times out a stalled market request onto the plain empty state (G91)', async () => {
        useFakeTimeouts();
        const getMarkets = vi.fn()
            .mockImplementationOnce(() => new Promise(() => {}))
            .mockResolvedValueOnce([{ tick1: 'BTC', tick2: 'PEPE', depth: 9 }]);
        render(
            <MessagingProvider shell="web" messaging={{
                getMarkets,
                listWatchlistForWallet: vi.fn().mockResolvedValue([]),
            }}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading markets');
        await act(async () => vi.advanceTimersByTimeAsync(15_000));
        // The stall ends the busy state; the list settles on its empty state.
        expect(screen.queryByText('Loading markets')).toBeNull();
        expect(screen.getByText('No markets for BTC')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
        expect(getMarkets).toHaveBeenCalledTimes(1);
    });

    it('reaches the watchlist through the filter, with no star in the rows', async () => {
        render(
            <MessagingProvider shell="web" messaging={{
                getMarkets: vi.fn().mockResolvedValue([
                    { tick1: 'PEPE', tick2: 'BTC', depth: 9 },
                    { tick1: 'XCP', tick2: 'BTC', depth: 4 },
                ]),
                listWatchlistForWallet: vi.fn().mockResolvedValue([
                    { id: 'a', walletId: 'w', chainId: 'bitcoin-mainnet', tick1: 'XCP', tick2: 'BTC' },
                ]),
            }}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        await screen.findByRole('button', { name: 'Open PEPE market' });
        expect(screen.queryByRole('button', { name: /watchlist/i })).toBeNull();
        expect(document.body.textContent).not.toMatch(/[★☆]/);
        chooseShow('watchlist');
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Open PEPE market' })).toBeNull());
        expect(screen.getByRole('button', { name: 'Open XCP market' })).toBeInTheDocument();
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
        // Show is a select in the filter, defaulting to Popular.
        openFilter();
        const show = screen.getByLabelText('Show markets');
        expect(show).toHaveValue('popular');
        selectOption(show, 'all');
        expect(show).toHaveValue('all');
        expect(await screen.findByText('FFF')).toBeInTheDocument();
    });

    it('assigns unique keys when the explorer repeats a market pair', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'BTC', tick2: 'PEPE', depth: 9 },
                { tick1: 'BTC', tick2: 'PEPE', depth: 8 },
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
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findAllByRole('button', { name: 'Open PEPE market' })).toHaveLength(2);
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
        consoleError.mockRestore();
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

        // Search sits behind the title-line filter, which focuses it on open.
        const counterparty = { name: 'Open Counterparty market' };
        await screen.findByRole('button', counterparty);
        fireEvent.click(screen.getByRole('button', { name: 'Filter markets' }));
        const search = screen.getByRole('searchbox', { name: 'Search markets' });
        expect(search).toHaveFocus();
        expect(search).toHaveAttribute('aria-controls');
        expect(document.getElementById(search.getAttribute('aria-controls'))).toHaveAttribute('role', 'region');
        fireEvent.change(search, { target: { value: 'pepe collectible' } });
        expect(screen.getByRole('button', counterparty)).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('button', counterparty)).toBeNull());
        expect(screen.getByText('PEPE')).toBeInTheDocument();

        // ArrowDown moves into the list and leaves the filter open.
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(document.activeElement).toHaveAttribute('data-market-result', 'true');
        expect(screen.getByRole('searchbox', { name: 'Search markets' })).toBe(search);
        search.focus();
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'BTC', 'PEPE');

        fireEvent.change(search, { target: { value: 'absent' } });
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
        expect(search).toHaveValue('');
        expect(screen.getByRole('button', counterparty)).toBeInTheDocument();
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
        chooseShow('all');
        expect(screen.getAllByRole('listitem')).toHaveLength(25);
        fireEvent.click(screen.getByRole('button', { name: 'Load More Markets' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(30);

        openFilter();
        const search = screen.getByRole('searchbox', { name: 'Search markets' });
        fireEvent.change(search, { target: { value: 'missing' } });
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
        expect(search).toHaveValue('');
        expect(await screen.findByText('TOKEN0')).toBeInTheDocument();
    });

    it('shows a loading skeleton, then the plain empty state when marketplace activity fails (G91)', async () => {
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
        // A failed read shows the page's ordinary empty state: no error line and
        // no Try Again of the page's own (G91).
        expect(await screen.findByText('No open offers')).toBeInTheDocument();
        expect(screen.queryByText('Some marketplace activity could not be loaded.')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
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

        await screen.findByRole('button', { name: 'Filter markets' });
        chooseShow('all');
        await screen.findByText('TOKEN0000');
        const list = screen.getByRole('list', { name: 'Markets' });
        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25));
        expect(screen.getByText('25 of 5,000 markets shown')).toBeInTheDocument();

        const scroller = screen.getByRole('main');
        scroller.scrollTop = 241;
        const showMore = screen.getByRole('button', { name: 'Load More Markets' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(50));
        expect(scroller.scrollTop).toBe(241);
    });
});
