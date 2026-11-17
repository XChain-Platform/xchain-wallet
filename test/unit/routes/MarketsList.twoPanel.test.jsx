// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Operator ruling 2026-11-13: on wide content the DEX is two panels, the
// market list on the left and the picked market on the right. Narrower, a
// row opens the market page as before.

import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    DEX_LIST_WIDTH_KEY,
    DEX_TWO_PANEL_MIN_WIDTH,
    MarketsList,
} from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { MarketView } from '../../../packages/core/src/shared/routes/MarketView.jsx';
import { DISPLAY_PREFS_CACHE_KEY } from '../../../packages/core/src/shared/hooks/useSettingsRootAttributes.js';

// The market page's data panels read on their own; the panel layout is what
// these tests pin, so they stand in as plain blocks.
vi.mock('../../../packages/core/src/shared/components/OrderbookPanel.jsx', () => ({
    OrderbookPanel: ({ tick1, tick2 }) => React.createElement('div', null, `Book ${tick1}/${tick2}`),
}));
vi.mock('../../../packages/core/src/shared/components/RecentTradesPanel.jsx', () => ({
    RecentTradesPanel: () => React.createElement('div', null, 'Recent trades panel'),
}));
vi.mock('../../../packages/core/src/shared/components/OpenOrdersPanel.jsx', () => ({
    OpenOrdersPanel: () => React.createElement('div', null, 'Open orders panel'),
}));
vi.mock('../../../packages/core/src/shared/components/TradeHistoryPanel.jsx', () => ({
    TradeHistoryPanel: () => React.createElement('div', null, 'Trade history panel'),
}));

const ASSET = { chainId: 'bitcoin-mainnet', tick: 'BTC' };
// Settings reads on first load, per row count, compared across the read-count cases.
const settingsReadsByRowCount = new Map();
let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    localStorage.clear();
    // jsdom has no layout: the DEX's measured box reports the width under test.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-dex-layout')) {
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

function marketRows(count) {
    return Array.from({ length: count }, (_, i) => ({ tick1: `TOK${i}`, tick2: 'BTC', depth: 100 - i }));
}

function makeMessaging(rows) {
    return {
        getMarkets: vi.fn().mockResolvedValue(rows),
        getMarket: vi.fn().mockResolvedValue({}),
        getMarketHistory: vi.fn().mockResolvedValue([]),
        // The market panel reads settings for its explorer link.
        getSettings: vi.fn().mockResolvedValue({}),
        listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        saveWatchlistEntry: vi.fn().mockResolvedValue({}),
        clearWatchlistEntry: vi.fn().mockResolvedValue({}),
    };
}

// A shell as web, desktop and the extension wire it: the pick lives in the
// shell's activeMarket and the right panel is the embedded market page.
function Shell({ onOpenMarket, onTrade }) {
    const [activeMarket, setActiveMarket] = useState(null);
    return (
        <MarketsList
            walletId="w"
            selectedAsset={ASSET}
            onChangeAsset={() => {}}
            onOpenMarket={onOpenMarket}
            selectedMarket={activeMarket}
            onSelectMarket={(chainId, tick1, tick2) => setActiveMarket({ chainId, tick1, tick2 })}
            renderMarket={(market, panel) => (
                <MarketView
                    embedded
                    walletId="w"
                    chainId={market.chainId}
                    tick1={market.tick1}
                    tick2={market.tick2}
                    onWatchlistChange={panel.onWatchlistChange}
                    onSwap={() => setActiveMarket({ chainId: market.chainId, tick1: market.tick2, tick2: market.tick1 })}
                    onTrade={(trade) => onTrade?.(market, trade)}
                />
            )}
        />
    );
}

function renderShell(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Shell onOpenMarket={vi.fn()} {...props} />
        </MessagingProvider>,
    );
}

describe('MarketsList two panels on wide content', () => {
    it('shows the list beside the first market, with one page header', async () => {
        layoutWidth = 1046; // Desktop 1280 beside its 220px sidebar
        const messaging = makeMessaging(marketRows(3));
        renderShell(messaging);

        const panel = await screen.findByRole('region', { name: 'TOK0/BTC market' });
        const list = screen.getByRole('list', { name: 'Markets' });
        const listScroller = screen.getByRole('region', { name: 'Markets' });
        const assetSelector = screen.getByRole('button', { name: 'Change asset (currently Bitcoin)' });
        expect(listScroller).toContainElement(list);
        expect(listScroller).not.toContainElement(assetSelector);
        expect(list.closest('[data-dex-layout]')).toHaveAttribute('data-dex-layout', 'two-panel');
        expect(panel.contains(list)).toBe(false);
        // The market's card names it; the page header stays the exchange's.
        expect(await within(panel).findByText('TOK0 / BTC')).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Decentralized Exchange']);
        expect(document.querySelectorAll('main')).toHaveLength(1);
        // The market inside the panel is one column, as on a phone.
        expect(panel.querySelector('[data-market-layout]')).toHaveAttribute('data-market-layout', 'single');
        // The first row is the shown market.
        const first = screen.getByRole('button', { name: 'Open TOK0 market' });
        expect(list.closest('[data-xc-split-list]')).not.toBeNull();
        expect(first).toHaveAttribute('data-xc-split-row');
        expect(first).toHaveAttribute('aria-current', 'true');
        expect(first.closest('li')).not.toHaveAttribute('data-selected');
        expect(screen.getByRole('button', { name: 'Open TOK1 market' })).not.toHaveAttribute('aria-current');
    });

    it('swaps the right panel when a row is clicked and leaves the list in place', async () => {
        layoutWidth = 1686; // Desktop 1920
        const onOpenMarket = vi.fn();
        const messaging = makeMessaging(marketRows(3));
        renderShell(messaging, { onOpenMarket });

        await screen.findByRole('region', { name: 'TOK0/BTC market' });
        const list = screen.getByRole('list', { name: 'Markets' });
        fireEvent.click(screen.getByRole('button', { name: 'Open TOK2 market' }));

        const panel = await screen.findByRole('region', { name: 'TOK2/BTC market' });
        expect(await within(panel).findByText('TOK2 / BTC')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'TOK0/BTC market' })).toBeNull();
        expect(onOpenMarket).not.toHaveBeenCalled();
        expect(screen.getByRole('list', { name: 'Markets' })).toBe(list);
        expect(screen.getByRole('button', { name: 'Open TOK2 market' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: 'Open TOK0 market' })).not.toHaveAttribute('aria-current');
    });

    it('saves and restores the shared split width under the markets page key', async () => {
        layoutWidth = 1046;
        const first = renderShell(makeMessaging(marketRows(3)));
        await screen.findByRole('region', { name: 'TOK0/BTC market' });
        const divider = screen.getByRole('separator', { name: 'Resize the market list' });
        fireEvent.keyDown(divider, { key: 'ArrowRight' });
        const saved = JSON.parse(localStorage.getItem(DISPLAY_PREFS_CACHE_KEY));
        expect(DEX_LIST_WIDTH_KEY).toBe('markets');
        expect(saved.panelSplits.markets).toBe(385);

        first.unmount();
        renderShell(makeMessaging(marketRows(3)));
        await screen.findByRole('region', { name: 'TOK0/BTC market' });
        expect(screen.getByRole('separator', { name: 'Resize the market list' }))
            .toHaveAttribute('aria-valuenow', '385');
    });

    it('keeps the pick marked after the reverse-pair button flips it', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(marketRows(3)));
        fireEvent.click(await screen.findByRole('button', { name: 'Open TOK1 market' }));
        const panel = await screen.findByRole('region', { name: 'TOK1/BTC market' });
        fireEvent.click(await within(panel).findByRole('button', { name: /BTC\/TOK1/ }));

        expect(await screen.findByRole('region', { name: 'BTC/TOK1 market' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open TOK1 market' })).toHaveAttribute('aria-current', 'true');
    });

    it('opens the Trade form from Buy and Sell in the right panel', async () => {
        layoutWidth = 1046;
        const onTrade = vi.fn();
        renderShell(makeMessaging(marketRows(3)), { onTrade });
        const panel = await screen.findByRole('region', { name: 'TOK0/BTC market' });

        fireEvent.click(await within(panel).findByRole('button', { name: 'Buy' }));
        fireEvent.click(within(panel).getByRole('button', { name: 'Sell' }));
        expect(onTrade.mock.calls).toEqual([
            [{ chainId: 'bitcoin-mainnet', tick1: 'TOK0', tick2: 'BTC' }, { side: 'buy', mode: 'swap' }],
            [{ chainId: 'bitcoin-mainnet', tick1: 'TOK0', tick2: 'BTC' }, { side: 'sell', mode: 'swap' }],
        ]);
    });

    it.each([3, 10])('reads the markets once and each shown market once with %i rows', async (count) => {
        layoutWidth = 1046;
        const messaging = makeMessaging(marketRows(count));
        renderShell(messaging);
        await screen.findByRole('region', { name: 'TOK0/BTC market' });
        await waitFor(() => expect(messaging.getMarketHistory).toHaveBeenCalledTimes(1));
        expect(messaging.getMarkets).toHaveBeenCalledTimes(1);
        expect(messaging.getMarket).toHaveBeenCalledTimes(1);

        const settingsBefore = messaging.getSettings.mock.calls.length;
        settingsReadsByRowCount.set(count, settingsBefore);
        fireEvent.click(screen.getByRole('button', { name: 'Open TOK1 market' }));
        await screen.findByRole('region', { name: 'TOK1/BTC market' });
        await waitFor(() => expect(messaging.getMarket).toHaveBeenCalledTimes(2));
        expect(messaging.getMarketHistory).toHaveBeenCalledTimes(2);
        expect(messaging.getMarkets).toHaveBeenCalledTimes(1);
        // The panel's explorer link reads settings once per shown market, and
        // the page's settings reads do not grow with the row count.
        await waitFor(() => expect(messaging.getSettings.mock.calls.length - settingsBefore).toBe(1));
        expect(new Set(settingsReadsByRowCount.values()).size).toBe(1);
        // No read per row: the counts above do not move with the row count.
        expect(messaging.getMarket.mock.calls.map(([args]) => args.tick1)).toEqual(['TOK0', 'TOK1']);
    });
});

describe('MarketsList on an iPad', () => {
    // Layout 2 (operator 2026-11-13): an iPad shows the slim list beside the market.
    it.each([
        ['iPad 834 beside its icon rail', 756],
        ['iPad Pro 11 landscape beside its sidebar', 960],
    ])('shows two panels at %s', async (_label, width) => {
        layoutWidth = width;
        renderShell(makeMessaging(marketRows(3)));
        await screen.findByRole('region', { name: 'TOK0/BTC market' });
        expect(screen.getByRole('list', { name: 'Markets' }).closest('[data-dex-layout]')).toHaveAttribute('data-dex-layout', 'two-panel');
        expect(screen.getByRole('separator', { name: 'Resize the market list' })).toBeInTheDocument();
    });
});

describe('MarketsList narrow fallback', () => {
    it.each([
        ['a phone in landscape', 640],
        ['just under the threshold', DEX_TWO_PANEL_MIN_WIDTH - 1],
        ['no layout yet', 0],
    ])('keeps the list, then the market page, at %s', async (_label, width) => {
        layoutWidth = width;
        const onOpenMarket = vi.fn();
        const messaging = makeMessaging(marketRows(3));
        renderShell(messaging, { onOpenMarket });

        const row = await screen.findByRole('button', { name: 'Open TOK1 market' });
        expect(row).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('list', { name: 'Markets' }).closest('[data-dex-layout]')).toHaveAttribute('data-dex-layout', 'list');
        expect(screen.queryByRole('region', { name: /market$/ })).toBeNull();
        fireEvent.click(row);
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'TOK1', 'BTC');
        // The market page's reads wait for the page itself.
        expect(messaging.getMarket).not.toHaveBeenCalled();
        expect(messaging.getMarketHistory).not.toHaveBeenCalled();
    });

    it('never splits for a host without a market panel, however wide', async () => {
        layoutWidth = 1686;
        const onOpenMarket = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={makeMessaging(marketRows(3))}>
                <MarketsList walletId="w" selectedAsset={ASSET} onChangeAsset={() => {}} onOpenMarket={onOpenMarket} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Open TOK0 market' }));
        expect(onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 'TOK0', 'BTC');
        expect(screen.queryByRole('region', { name: /market$/ })).toBeNull();
    });
});

describe('MarketView columns follow its container', () => {
    it('keeps its own page header and the responsive layout when standalone', async () => {
        render(
            <MessagingProvider shell="web" messaging={makeMessaging([])}>
                <MarketView walletId="w" chainId="bitcoin-mainnet" tick1="TOK0" tick2="BTC" onBack={() => {}} onTrade={() => {}} />
            </MessagingProvider>,
        );
        expect(await screen.findByRole('heading', { level: 1, name: 'TOK0/BTC' })).toBeInTheDocument();
        await waitFor(() => expect(document.querySelector('[data-market-layout]')).toHaveAttribute('data-market-layout', 'responsive'));
    });

    it('switches to two columns on the page width, not a viewport media query', () => {
        const css = readFileSync('packages/core/src/shared/routes/MarketView.module.css', 'utf8');
        expect(css).not.toMatch(/@media \(min-width: 834px\)/);
        expect(css).toMatch(/@supports \(container-type: inline-size\) and \(width: 1cqw\)/);
        expect(css).toMatch(/@container \(min-width: 750px\)\s*\{\s*\.layoutResponsive\s*\{[^}]*grid-template-columns/);
    });
});
