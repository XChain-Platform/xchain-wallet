// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

const markets = [
    { action_index: 7, tick: 'XCHAIN', label: 'First market', outcomes: 'Yes,No', feed_status: 'open' },
    { action_index: 8, tick: 'XCHAIN', label: 'Second market', outcomes: 'Up,Down', feed_status: 'open' },
];

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return { width: layoutWidth, height: 800, top: 0, left: 0, right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {} };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
});

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: ADDRESS }] }),
        betFeeds: vi.fn().mockResolvedValue({ data: markets }),
    };
}

function Shell({ route = 'bet-markets', initialMarket = null, onOpenMarket = vi.fn(), onSelectMarket = vi.fn() }) {
    const [selectedMarket, setSelectedMarket] = useState(initialMarket);
    const select = (ref) => {
        onSelectMarket(ref);
        setSelectedMarket(ref);
    };
    return (
        <BetFeedsList
            walletId="wallet-1"
            onBack={() => {}}
            onOpenMarket={onOpenMarket}
            selectedMarket={selectedMarket}
            onSelectMarket={select}
            renderMarket={(ref) => <section><h2>{`Detail ${ref.feedIndex}`}</h2></section>}
            renderMarketPage={route === 'bet-market-detail'
                ? (ref, page) => <main ref={page.measureRef} data-list-detail="page"><h1>{`Market ${ref.feedIndex}`}</h1></main>
                : undefined}
        />
    );
}

function mount(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Shell {...props} />
        </MessagingProvider>,
    );
}

describe('BetFeedsList wide split', () => {
    it('preselects the first market and docks the tabs above the list scroller', async () => {
        layoutWidth = 1046;
        const onSelectMarket = vi.fn();
        mount(makeMessaging(), { onSelectMarket });

        const detail = await screen.findByRole('region', { name: 'First market' });
        expect(within(detail).getByRole('heading', { name: 'Detail 7' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: 'First market' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: 'First market' }).closest('li')).toHaveAttribute('data-selected', 'true');
        expect(screen.getByRole('button', { name: 'Second market' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('region', { name: 'Bet markets' })).toContainElement(screen.getByRole('list', { name: 'Bet markets' }));
        expect(screen.getByRole('region', { name: 'Bet markets' })).not.toContainElement(screen.getByRole('tablist', { name: 'Bet market views' }));
        await waitFor(() => expect(onSelectMarket).toHaveBeenCalledWith({ chainId: CHAIN, feedIndex: 7 }));
    });

    it('swaps the detail without opening a route and saves the shared width under bets', async () => {
        layoutWidth = 1686;
        const onOpenMarket = vi.fn();
        mount(makeMessaging(), { onOpenMarket });
        await screen.findByRole('region', { name: 'First market' });

        fireEvent.click(screen.getByRole('button', { name: 'Second market' }));
        const detail = await screen.findByRole('region', { name: 'Second market' });
        expect(within(detail).getByRole('heading', { name: 'Detail 8' })).toBeInTheDocument();
        expect(onOpenMarket).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Second market' })).toHaveAttribute('aria-current', 'true');

        fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the bet markets list' }), { key: 'ArrowLeft' });
        const prefs = JSON.parse(localStorage.getItem('xc:displayPrefs'));
        expect(prefs.panelSplits.bets).toBeGreaterThan(0);
    });

    it('keeps the docked tabs and selected detail when My markets is empty', async () => {
        layoutWidth = 1046;
        mount(makeMessaging());
        await screen.findByRole('region', { name: 'First market' });

        fireEvent.click(screen.getByRole('tab', { name: 'My markets' }));

        expect(await screen.findByRole('heading', { name: 'No markets yet' })).toBeInTheDocument();
        expect(screen.getByRole('tablist', { name: 'Bet market views' })).toBeInTheDocument();
        expect(screen.getByRole('separator', { name: 'Resize the bet markets list' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Detail 7' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Detail 8' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'All' }));
        expect(await screen.findByRole('button', { name: 'First market' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('heading', { name: 'Detail 7' })).toBeInTheDocument();
    });

    it('opens a deep-linked market in the split without changing its selection', async () => {
        layoutWidth = 1046;
        mount(makeMessaging(), {
            route: 'bet-market-detail',
            initialMarket: { chainId: CHAIN, feedIndex: 8 },
        });

        expect(await screen.findByRole('region', { name: 'Second market' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Second market' })).toHaveAttribute('aria-current', 'true');
    });
});

describe('BetFeedsList narrow behavior', () => {
    it('keeps the list route and opens a clicked market as before', async () => {
        layoutWidth = LIST_DETAIL_MIN_WIDTH - 1;
        const onOpenMarket = vi.fn();
        mount(makeMessaging(), { onOpenMarket });

        const second = await screen.findByRole('button', { name: 'Second market' });
        expect(screen.queryByRole('separator')).toBeNull();
        expect(second).not.toHaveAttribute('aria-current');
        fireEvent.click(second);
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, 8);
    });

    it('keeps the tabs available when narrow My markets is empty', async () => {
        layoutWidth = LIST_DETAIL_MIN_WIDTH - 1;
        mount(makeMessaging());
        await screen.findByRole('button', { name: 'First market' });

        fireEvent.click(screen.getByRole('tab', { name: 'My markets' }));
        expect(await screen.findByRole('heading', { name: 'No markets yet' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'All' }));
        expect(await screen.findByRole('button', { name: 'First market' })).toBeInTheDocument();
    });

    it('keeps a deep-linked detail standalone and does not read the list', async () => {
        layoutWidth = LIST_DETAIL_MIN_WIDTH - 1;
        const messaging = makeMessaging();
        mount(messaging, {
            route: 'bet-market-detail',
            initialMarket: { chainId: CHAIN, feedIndex: 8 },
        });

        expect(await screen.findByRole('heading', { name: 'Market 8' })).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Bet markets' })).toBeNull();
        expect(screen.queryByRole('separator')).toBeNull();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        expect(messaging.betFeeds).not.toHaveBeenCalled();
    });
});
