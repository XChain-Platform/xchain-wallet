// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';
import { userEvent } from '../../helpers/userEvent.js';
import chipStyles from '../../../packages/core/src/ui/Chip.module.css';
import marketsStyles from '../../../packages/core/src/shared/routes/MarketsList.module.css';
import { readFileSync } from 'node:fs';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
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
        expect(selector.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
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

        await screen.findByRole('button', { name: 'Open Pepe market' });
        const pair = screen.getByText('PEPE').closest(`.${chipStyles.chip}`);
        expect(pair).toHaveTextContent('BTC / PEPE');
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        back.focus();
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        await user.tab();
        expect(screen.getByRole('button', { name: /Change asset/ })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onChangeAsset).toHaveBeenCalledOnce();

        await user.tab();
        const search = screen.getByRole('searchbox', { name: 'Search markets' });
        expect(search).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'BTC', 'PEPE');

        // The market kind tabs are one roving tab stop on the selected tab.
        await user.tab();
        expect(screen.getByRole('tab', { name: 'Popular' })).toHaveFocus();
        for (const name of ['All', 'Watchlist']) {
            expect(screen.getByRole('tab', { name })).toHaveAttribute('tabindex', '-1');
        }

        await user.tab();
        const star = screen.getByRole('button', { name: 'Add to watchlist' });
        expect(star).toHaveFocus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(messaging.saveWatchlistEntry).toHaveBeenCalledWith({
            walletId: 'w', chainId: 'bitcoin-mainnet', tick1: 'BTC', tick2: 'PEPE',
        }));

        await user.tab();
        expect(screen.getByRole('button', { name: 'Open Pepe market' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onOpenMarket).toHaveBeenCalledTimes(2);
    });

    it('shortens a long ticker inside the pair chip and keeps the full pair as its title', async () => {
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

        const pair = (await screen.findByText(longTick)).closest(`.${chipStyles.chip}`);
        expect(pair).toHaveClass(marketsStyles.pairChip);
        expect(pair).toHaveAttribute('title', `${longTick} / BTC`);
        const css = readFileSync('packages/core/src/shared/routes/MarketsList.module.css', 'utf8');
        expect(css).toMatch(/\.pairChip\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
        expect(css).toMatch(/\.pairTick\s*\{[^}]*text-overflow:\s*ellipsis/s);
        // The depth pill stays on one line however long the pair name is.
        expect(screen.getByText('depth 3')).toHaveStyle({ whiteSpace: 'nowrap' });
        // The figures slot is not capped at half the row, so at larger text the
        // depth pill stays inside the row padding instead of spilling past it.
        const trailing = screen.getByText('depth 3').closest(`.${marketsStyles.marketTrailing}`);
        expect(trailing).not.toBeNull();
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

        const search = await screen.findByRole('searchbox', { name: 'Search markets' });
        expect(search.closest('[class*="searchField"]')).toBeInTheDocument();
        expect(search.closest('[class*="searchField"]').parentElement.style.flexWrap).toBe('wrap');
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

    it('times out a stalled market request and retries it', async () => {
        vi.useFakeTimers();
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
        expect(screen.getByText('Could not load markets. Try again.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByText('PEPE')).toBeInTheDocument();
        expect(getMarkets).toHaveBeenCalledTimes(2);
    });

    it('locks a watchlist button while its write is pending', async () => {
        const save = deferred();
        const saveWatchlistEntry = vi.fn(() => save.promise);
        render(
            <MessagingProvider shell="web" messaging={{
                getMarkets: vi.fn().mockResolvedValue([
                    { tick1: 'BTC', tick2: 'PEPE', depth: 9 },
                ]),
                listWatchlistForWallet: vi.fn().mockResolvedValue([]),
                saveWatchlistEntry,
            }}>
                <MarketsList
                    walletId="w"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </MessagingProvider>,
        );

        const star = await screen.findByRole('button', { name: 'Add to watchlist' });
        fireEvent.click(star);
        fireEvent.click(star);
        expect(star).toBeDisabled();
        expect(star).toHaveAttribute('aria-busy', 'true');
        expect(saveWatchlistEntry).toHaveBeenCalledOnce();

        save.resolve({});
        await waitFor(() => expect(star).not.toBeDisabled());
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

        const search = await screen.findByRole('searchbox', { name: 'Search markets' });
        await screen.findByText('Counterparty');
        fireEvent.change(search, { target: { value: 'pepe collectible' } });
        expect(screen.getByText('Counterparty')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Counterparty')).toBeNull());
        expect(screen.getByText('PEPE')).toBeInTheDocument();

        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'BTC', 'PEPE');

        fireEvent.change(search, { target: { value: 'absent' } });
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
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
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
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
        await screen.findByText('TOKEN0000');
        const list = screen.getByRole('list', { name: 'Markets' });
        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25));
        expect(screen.getByText('25 of 5,000 markets shown')).toBeInTheDocument();

        const scroller = screen.getByRole('main');
        scroller.scrollTop = 241;
        const showMore = screen.getByRole('button', { name: 'Load more markets' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(50));
        expect(scroller.scrollTop).toBe(241);
    });
});
