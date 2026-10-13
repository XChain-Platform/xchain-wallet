// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RecentTradesPanel } from '../../../packages/core/src/shared/components/RecentTradesPanel.jsx';
import { TradeHistoryPanel } from '../../../packages/core/src/shared/components/TradeHistoryPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = { id: 'address-1', address: 'bc1qownerexample', source: 'hd' };

afterEach(() => cleanup());

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('trading history panel display states', () => {
    it('distinguishes empty and failed Recent Trades requests', async () => {
        const getMarketHistory = vi.fn().mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('network unavailable'));
        const view = render(
            <MessagingProvider shell="web" messaging={{ getMarketHistory }}>
                <RecentTradesPanel chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(await screen.findByText('No trades yet.')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();

        view.rerender(
            <MessagingProvider shell="web" messaging={{ getMarketHistory }}>
                <RecentTradesPanel chainId={CHAIN} tick1="XCHAIN" tick2="DOGE" />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load recent trades.");
        expect(screen.queryByText('No trades yet.')).toBeNull();
    });

    it('keeps Recent Trades busy until data resolves and aligns numeric rows', async () => {
        const request = deferred();
        render(
            <MessagingProvider shell="web" messaging={{ getMarketHistory: vi.fn(() => request.promise) }}>
                <RecentTradesPanel chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading recent trades…');
        expect(screen.queryByText('No trades yet.')).toBeNull();
        expect(screen.getByRole('region', { name: 'Recent trades' })).toHaveAttribute('aria-busy', 'true');

        await act(async () => request.resolve([{
            action_index: 1,
            type: 'buy',
            price: '1.25',
            amount: '2.5000',
            timestamp: 1_800_000_000,
        }]));

        const price = await screen.findByText('1.2500');
        const side = screen.getByText('Buy');
        expect(price.style.textAlign).toBe('right');
        expect(price.style.fontVariantNumeric).toBe('tabular-nums');
        expect(side.style.color).toBe('var(--xc-success)');
        expect(screen.getByText('Price').parentElement.parentElement.style.overflowX).toBe('auto');
        expect(screen.queryByText('Loading recent trades…')).toBeNull();
    });

    it('keeps Trade History busy through address and history loads', async () => {
        const addressRequest = deferred();
        const historyRequest = deferred();
        const getMarketHistory = vi.fn(() => historyRequest.promise);
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn(() => addressRequest.promise),
                getMarketHistory,
            }}>
                <TradeHistoryPanel
                    walletId="wallet-1"
                    chainId={CHAIN}
                    tick1="XCHAIN"
                    tick2="BTC"
                />
            </MessagingProvider>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading trade history…');
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();

        await act(async () => addressRequest.resolve({ [CHAIN]: [OWNER] }));
        expect(getMarketHistory).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick1: 'XCHAIN',
            tick2: 'BTC',
            address: OWNER.address,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Loading trade history…');

        await act(async () => historyRequest.resolve([{
            action_index: 2,
            type: 'sell',
            price: '1.25',
            amount: '2.5000',
            timestamp: 1_800_000_000,
        }]));

        const price = await screen.findByText('1.25');
        const side = screen.getByText('Sell');
        expect(price.style.textAlign).toBe('right');
        expect(price.style.fontVariantNumeric).toBe('tabular-nums');
        expect(side.style.color).toBe('var(--xc-danger)');
        expect(screen.getByText('Price').parentElement.parentElement.style.overflowX).toBe('auto');
        expect(screen.getByRole('region', { name: 'Trade history' })).not.toHaveAttribute('aria-busy');
    });

    it('distinguishes empty Trade History from address and history failures', async () => {
        const getAddressesByChain = vi.fn()
            .mockResolvedValueOnce({ [CHAIN]: [] })
            .mockRejectedValueOnce(new Error('address service unavailable'))
            .mockResolvedValueOnce({ [CHAIN]: [OWNER] });
        const getMarketHistory = vi.fn().mockRejectedValue(new Error('history service unavailable'));
        const messaging = { getAddressesByChain, getMarketHistory };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TradeHistoryPanel walletId="wallet-empty" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(await screen.findByText('No trades on this market yet.')).toBeInTheDocument();
        expect(getMarketHistory).not.toHaveBeenCalled();

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <TradeHistoryPanel walletId="wallet-address-failure" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your trade history.");
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <TradeHistoryPanel walletId="wallet-history-failure" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your trade history.");
        expect(getMarketHistory).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick1: 'XCHAIN',
            tick2: 'BTC',
            address: OWNER.address,
        });
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();
    });

    it('removes stale Trade History rows when refresh fails', async () => {
        const getMarketHistory = vi.fn()
            .mockResolvedValueOnce([{
                action_index: 3,
                type: 'buy',
                price: '3.5',
                amount: '4',
                timestamp: 1_800_000_000,
            }])
            .mockRejectedValueOnce(new Error('network unavailable'));
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
                getMarketHistory,
            }}>
                <TradeHistoryPanel walletId="wallet-1" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(await screen.findByText('3.5')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your trade history.");
        expect(screen.queryByText('3.5')).toBeNull();
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();
    });
});
