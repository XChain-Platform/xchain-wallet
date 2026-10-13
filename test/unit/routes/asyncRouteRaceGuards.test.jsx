// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { MyBets } from '../../../packages/core/src/shared/routes/MyBets.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { MultisigSigningSession } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';

const CHAIN = 'bitcoin-mainnet';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function messagingWith(methods) {
    return new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            return () => Promise.resolve(undefined);
        },
    });
}

function route(Component, messaging, props) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <Component {...props} />
        </MessagingProvider>
    );
}

afterEach(() => cleanup());

describe('async route parameter races', () => {
    it('keeps the new wallet watchlist when the old wallet resolves last', async () => {
        const oldRequest = deferred();
        const newRequest = deferred();
        const messaging = messagingWith({
            getMarkets: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn(({ walletId }) => (
                walletId === 'old-wallet' ? oldRequest.promise : newRequest.promise
            )),
        });
        const props = {
            selectedAsset: { chainId: CHAIN, tick: 'BTC' },
            onChangeAsset() {},
            onOpenMarket() {},
        };
        const view = render(route(MarketsList, messaging, { ...props, walletId: 'old-wallet' }));
        await waitFor(() => expect(messaging.listWatchlistForWallet).toHaveBeenCalledTimes(1));
        view.rerender(route(MarketsList, messaging, { ...props, walletId: 'new-wallet' }));
        await waitFor(() => expect(messaging.listWatchlistForWallet).toHaveBeenCalledTimes(2));

        await act(async () => {
            newRequest.resolve([{ id: 'new', chainId: CHAIN, tick1: 'BTC', tick2: 'NEW' }]);
            await newRequest.promise;
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Watchlist' }));
        expect(await screen.findByText('NEW')).toBeInTheDocument();

        await act(async () => {
            oldRequest.resolve([{ id: 'old', chainId: CHAIN, tick1: 'BTC', tick2: 'OLD' }]);
            await oldRequest.promise;
        });
        expect(screen.getByText('NEW')).toBeInTheDocument();
        expect(screen.queryByText('OLD')).toBeNull();
    });

    it.each([
        ['bets', MyBets, 'bets'],
        ['orders', MyOrdersView, 'getOrdersForAddress'],
        ['swaps', MySwapsView, 'getSwapsForAddress'],
    ])('does not let an old wallet start stale %s reads', async (_label, Component, readMethod) => {
        const oldRequest = deferred();
        const addresses = vi.fn((walletId) => (
            walletId === 'old-wallet' ? oldRequest.promise : Promise.resolve({})
        ));
        const staleRead = vi.fn().mockResolvedValue([]);
        const messaging = messagingWith({
            getAddressesByChain: addresses,
            [readMethod]: staleRead,
            getOrderCancelsForAddress: vi.fn().mockResolvedValue([]),
            getSwapCancelsForAddress: vi.fn().mockResolvedValue([]),
            listAutopayOrders: vi.fn().mockResolvedValue([]),
        });
        const props = { onBack() {} };
        const view = render(route(Component, messaging, { ...props, walletId: 'old-wallet' }));
        await waitFor(() => expect(addresses).toHaveBeenCalledWith('old-wallet', undefined));
        view.rerender(route(Component, messaging, { ...props, walletId: 'new-wallet' }));
        await waitFor(() => expect(addresses).toHaveBeenCalledWith('new-wallet', undefined));

        await waitFor(() => expect(screen.getByText(new RegExp(`No ${_label} yet`, 'i'))).toBeInTheDocument());
        await act(async () => {
            oldRequest.resolve({ [CHAIN]: [{ address: 'old-address' }] });
            await oldRequest.promise;
        });

        expect(staleRead).not.toHaveBeenCalled();
        expect(screen.getByText(new RegExp(`No ${_label} yet`, 'i'))).toBeInTheDocument();
    });

    it('keeps the new wallet multisig list when the old wallet resolves last', async () => {
        const oldRequest = deferred();
        const newRequest = deferred();
        const messaging = messagingWith({
            listMultisigSigningSessions: vi.fn(({ walletId }) => (
                walletId === 'old-wallet' ? oldRequest.promise : newRequest.promise
            )),
        });
        const props = { onBack() {} };
        const view = render(route(MultisigSigningSession, messaging, { ...props, walletId: 'old-wallet' }));
        await waitFor(() => expect(messaging.listMultisigSigningSessions).toHaveBeenCalledTimes(1));
        view.rerender(route(MultisigSigningSession, messaging, { ...props, walletId: 'new-wallet' }));
        await waitFor(() => expect(messaging.listMultisigSigningSessions).toHaveBeenCalledTimes(2));

        await act(async () => {
            newRequest.resolve([]);
            await newRequest.promise;
        });
        expect(await screen.findByText('No signing sessions')).toBeInTheDocument();

        await act(async () => {
            oldRequest.resolve([{
                id: 'old-session',
                threshold: 1,
                cosignerPubkeys: ['02'.padEnd(66, '1')],
                scheme: 'p2wsh-multisig',
                status: 'collecting-sigs',
            }]);
            await oldRequest.promise;
        });
        expect(screen.getByText('No signing sessions')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Multisig sessions' })).toBeNull();
    });
});
