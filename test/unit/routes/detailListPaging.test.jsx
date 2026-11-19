// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const chainRegistry = registryLib.defaultRegistry();
const CHAIN = 'bitcoin-regtest';

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});

afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

function address(index) {
    return `bcrt1qholder${String(index).padStart(4, '0')}xxxxxxxxxxxxxxxxxxxx`;
}

function holder(index) {
    return { address: address(index), amount: String(index + 1) };
}

describe('TokenDetail holder paging', () => {
    it('appends unique explorer pages, reports the count, and keeps scroll position', async () => {
        const first = Array.from({ length: 25 }, (_, index) => holder(index));
        const second = [holder(24), ...Array.from({ length: 24 }, (_, index) => holder(index + 25))];
        const getHoldersForToken = vi.fn(({ opts }) => Promise.resolve({
            total: 49,
            data: opts.page === 1 ? first : second,
        }));
        const messaging = {
            getTokenInfo: vi.fn().mockResolvedValue({ creator: address(99) }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken,
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="w1"
                    chainId={CHAIN}
                    tick="PAGED"
                    kind="token"
                    divisibility={0}
                    quantity="1"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        // The secondary token surfaces are links in the Details tab now.
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        fireEvent.click(screen.getByRole('button', { name: /Holders/ }));
        expect(await screen.findByText('Holders (25 of 49)')).toBeTruthy();
        const list = screen.getByRole('list', { name: 'Holder balances' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(25);
        expect(within(list).getByText('1')).toBeTruthy();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 137;
        fireEvent.click(screen.getByRole('button', { name: 'Load More Holders' }));

        await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(49));
        expect(screen.getByText('Holders (49)')).toBeTruthy();
        expect(getHoldersForToken).toHaveBeenLastCalledWith({
            chainId: CHAIN,
            tick: 'PAGED',
            opts: { page: 2, limit: 25 },
        });
        expect(scroller.scrollTop).toBe(137);
        expect(screen.queryByRole('button', { name: 'Load More Holders' })).toBeNull();
    });
});

describe('ListDetail member paging', () => {
    it('deduplicates members before counting and appends the next page in place', async () => {
        const members = [
            ...Array.from({ length: 26 }, (_, index) => address(index)),
            address(10),
        ];
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({
                type: '2',
                status: 'valid',
                source: address(99),
                list: members,
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListDetail
                    chainId={CHAIN}
                    actionIndex="77"
                    onBack={() => {}}
                    onFork={() => {}}
                />
            </MessagingProvider>,
        );

        // The members sit on the List tab, 25 to a page, the duplicate dropped.
        fireEvent.click(await screen.findByRole('tab', { name: 'List' }));
        await screen.findByRole('button', { name: 'Load More Members' });
        const list = document.querySelector('ul');
        expect(list.querySelectorAll('li')).toHaveLength(25);
        const scroller = document.querySelector('main');
        scroller.scrollTop = 83;
        fireEvent.click(screen.getByRole('button', { name: 'Load More Members' }));

        expect(list.querySelectorAll('li')).toHaveLength(26);
        expect(scroller.scrollTop).toBe(83);
        expect(screen.queryByRole('button', { name: 'Load More Members' })).toBeNull();
    });
});

describe('DispenserExplorer result paging', () => {
    async function searchPagedDispensers() {
        const first = Array.from({ length: 25 }, (_, index) => ({
            action_index: String(index),
            give_tick: 'PAGED',
            address: address(index),
            status: 'valid',
        }));
        const second = [first[24], ...Array.from({ length: 24 }, (_, index) => ({
            action_index: String(index + 25),
            give_tick: 'PAGED',
            address: address(index + 25),
            status: 'valid',
        }))];
        // The search fans out over every chain on the active network; one chain
        // holds the paged results so its section pages on its own.
        const chainId = chainRegistry.supportedChains().find((d) => d.networkKind === 'regtest').id;
        const getDispensersForToken = vi.fn(({ chainId: cid, opts }) => Promise.resolve(cid === chainId ? {
            total: 49,
            data: opts.page === 1 ? first : second,
        } : { total: 0, data: [] }));
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ schemaVersion: 2, activeNetwork: 'regtest' }),
            updateSettings: vi.fn(),
            getDispensersForToken,
            getDispensersForAddress: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        // The search box lives in the title bar's filter panel (G04).
        fireEvent.click(screen.getByRole('button', { name: 'Filter dispensers' }));
        await waitFor(() => expect(screen.queryByText('Loading available networks…')).toBeNull());
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PAGED' } });
        fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

        const loadMore = await screen.findByRole('button', { name: /Load more results for/ });
        return loadMore;
    }

    it('shows how many of the matching results are loaded', async () => {
        await searchPagedDispensers();
        expect(screen.getByText('25 of 49')).toBeTruthy();
    });

    it('merges pages by action index and keeps the result scroller anchored', async () => {
        const loadMore = await searchPagedDispensers();
        const section = loadMore.closest('section');
        // Each result is a row button named by its terms ("... PAGED for ...");
        // rows print no seller address now, so the count alone proves the
        // duplicate across pages was merged (49, not 50).
        const cards = () => within(section).getAllByRole('button', { name: /PAGED for / });
        expect(cards()).toHaveLength(25);
        const scroller = document.querySelector('main');
        scroller.scrollTop = 211;
        fireEvent.click(loadMore);

        await waitFor(() => expect(cards()).toHaveLength(49));
        expect(scroller.scrollTop).toBe(211);
        expect(within(section).queryByRole('button', { name: /Load more results for/ })).toBeNull();
    });
});

describe('MarketActivity long lists', () => {
    it('pages unique activity rows without replacing the scroll container', async () => {
        const sales = [
            ...Array.from({ length: 51 }, (_, index) => ({
                action_index: String(index),
                status: 'valid',
                give_tick: 'XCHAIN',
                give_amount: String(index + 1),
                get_coin: 'BTC',
                get_amount: '0.01',
                timestamp: 1785186698 - index,
            })),
        ];
        sales.push({ ...sales[20] });
        let answered = false;
        const getDispenses = vi.fn().mockImplementation(() => {
            if (answered) return Promise.resolve({ data: [] });
            answered = true;
            return Promise.resolve({ data: sales });
        });
        const messaging = {
            getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
            getDispenses,
            getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
            getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
            getOrderDetail: vi.fn(),
            getSwapDetail: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketActivity walletId="w1" onBack={() => {}} />
            </MessagingProvider>,
        );

        // Dispenser sales are the Trades tab now.
        fireEvent.click(await screen.findByRole('tab', { name: 'Trades' }));
        const section = await screen.findByRole('region', { name: 'Recent trades' });
        // The card is just its rows now, with no title or count line above them.
        expect(within(section).queryByText(/\d+ recent/)).toBeNull();
        expect(within(section).getAllByRole('listitem')).toHaveLength(50);
        const list = within(section).getByRole('list');
        const scroller = document.querySelector('main');
        scroller.scrollTop = 319;
        fireEvent.click(within(section).getByRole('button', { name: 'Load More Recent Trades' }));

        expect(within(section).getAllByRole('listitem')).toHaveLength(51);
        expect(within(list).getAllByText('Sold 21 XCHAIN for 0.01 BTC')).toHaveLength(1);
        expect(scroller.scrollTop).toBe(319);
        expect(within(section).queryByRole('button', { name: 'Load More Recent Trades' })).toBeNull();
    });
});
