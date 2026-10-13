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

        fireEvent.click(screen.getByRole('tab', { name: 'Unlock' }));
        expect(await screen.findByText('Holders (25 of 49)')).toBeTruthy();
        const list = screen.getByRole('table', { name: 'Holder balances' });
        expect(list.querySelectorAll('tbody tr')).toHaveLength(25);
        expect(within(list).getByText('1')).toBeTruthy();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 137;
        fireEvent.click(screen.getByRole('button', { name: 'Load more holders' }));

        await waitFor(() => expect(list.querySelectorAll('tbody tr')).toHaveLength(49));
        expect(screen.getByText('Holders (49)')).toBeTruthy();
        expect(getHoldersForToken).toHaveBeenLastCalledWith({
            chainId: CHAIN,
            tick: 'PAGED',
            opts: { page: 2, limit: 25 },
        });
        expect(scroller.scrollTop).toBe(137);
        expect(screen.queryByRole('button', { name: 'Load more holders' })).toBeNull();
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

        expect(await screen.findByText('Members as published (26)')).toBeTruthy();
        const list = document.querySelector('ul');
        expect(list.querySelectorAll('li')).toHaveLength(25);
        const scroller = document.querySelector('main');
        scroller.scrollTop = 83;
        fireEvent.click(screen.getByRole('button', { name: 'Load more members' }));

        expect(list.querySelectorAll('li')).toHaveLength(26);
        expect(scroller.scrollTop).toBe(83);
        expect(screen.queryByRole('button', { name: 'Load more members' })).toBeNull();
    });
});

describe('DispenserExplorer result paging', () => {
    it('merges pages by action index and keeps the result scroller anchored', async () => {
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
        const getDispensersForToken = vi.fn(({ opts }) => Promise.resolve({
            total: 49,
            data: opts.page === 1 ? first : second,
        }));
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

        const chainId = chainRegistry.supportedChains().find((d) => d.networkKind === 'regtest').id;
        const select = await screen.findByRole('combobox');
        fireEvent.change(select, { target: { value: chainId } });
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PAGED' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));

        const loadMore = await screen.findByRole('button', { name: /Load more results for/ });
        expect(screen.getByText('25 of 49')).toBeTruthy();
        const section = loadMore.closest('section');
        expect(within(section).getAllByText(/#\d+/)).toHaveLength(25);
        const scroller = document.querySelector('main');
        scroller.scrollTop = 211;
        fireEvent.click(loadMore);

        await waitFor(() => expect(within(section).getAllByText(/#\d+/)).toHaveLength(49));
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

        const section = await screen.findByRole('region', { name: 'Recent dispenses' });
        expect(within(section).getByText('51')).toBeTruthy();
        expect(within(section).getAllByRole('listitem')).toHaveLength(50);
        const list = within(section).getByRole('list');
        const scroller = document.querySelector('main');
        scroller.scrollTop = 319;
        fireEvent.click(within(section).getByRole('button', { name: 'Load more recent dispenses' }));

        expect(within(section).getAllByRole('listitem')).toHaveLength(51);
        expect(within(list).getAllByText('Sold 21 XCHAIN for 0.01 BTC')).toHaveLength(1);
        expect(scroller.scrollTop).toBe(319);
        expect(within(section).queryByRole('button', { name: 'Load more recent dispenses' })).toBeNull();
    });
});
