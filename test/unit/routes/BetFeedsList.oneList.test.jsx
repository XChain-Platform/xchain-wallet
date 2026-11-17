// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Operator ruling 2026-11-13: Prediction markets' All view is the page. My predictions and
// My markets are the same list (same cards, layout, sorting and controls)
// and differ only in which markets are listed: My predictions keeps the markets the
// wallet has bet in, My markets the markets the wallet created. The page's
// reads stay bounded: they never grow with the markets on screen, and a tab
// switch reads nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList, marketsForView } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import cardStyles from '../../../packages/core/src/shared/components/BetMarketCard.module.css';
import listStyles from '../../../packages/core/src/shared/routes/BetFeedsList.module.css';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qownownownownownownownownownownownownow';
const OTHER = 'bc1qotherotherotherotherotherotherotherot';

afterEach(() => cleanup());

function market(i, source) {
    return {
        action_index: String(1000 - i),
        source,
        label: `Market ${i}`,
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        deadline: Math.floor(Date.now() / 1000) + 3600 + i,
        feed_status: 'open',
    };
}

function bet(m, n) {
    return { action_index: String(5000 + n), feed_action_index: m.action_index, outcome: 0, amount: '10', tick: 'XCHAIN', bet_status: 'open' };
}

/**
 * A messaging double that counts every read by method. The market read
 * answers like the explorer: a `source` query returns that creator's
 * markets, any other query the network's list.
 */
function harness({ markets, bets, addresses = [OWN] }) {
    const counts = {};
    const count = (name, answer) => vi.fn((req) => {
        counts[name] = (counts[name] || 0) + 1;
        return Promise.resolve(answer(req));
    });
    const messaging = {
        getAddressesByChain: count('getAddressesByChain', () => ({ [CHAIN]: addresses.map((address) => ({ address })) })),
        betFeeds: count('betFeeds', (req) => ({
            data: req?.type === 'source' ? markets.filter((m) => m.source === req.query) : markets,
        })),
        bets: count('bets', () => ({ data: bets })),
        betFeed: count('betFeed', () => ({ data: [] })),
    };
    return { messaging, counts };
}

async function mount(messaging, view = 'all') {
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedsList walletId="wallet-1" onOpenMarket={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await screen.findByRole('tab', { name: 'All' });
    if (view !== 'all') await pick(view);
    return utils;
}

const TAB_NAME = { all: 'All', bets: 'My predictions', markets: 'My markets' };

async function pick(view) {
    await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: TAB_NAME[view] }));
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
}

function listed(container) {
    return Array.from(container.querySelectorAll('[data-market-index]')).map((el) => el.getAttribute('data-market-index'));
}

function list(container) {
    return container.querySelector('ul[aria-label="Prediction markets"]');
}

// The list's markup with React's generated ids blanked: My markets re-reads
// its rows, so its cards remount and draw fresh useId values.
function markup(container) {
    return list(container).outerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
}

describe('Prediction markets: one list for All, My predictions and My markets', () => {
    it('draws the exact same list on all three tabs when every market is the wallet\'s', async () => {
        const markets = [market(1, OWN), market(2, OWN), market(3, OWN)];
        const { messaging } = harness({ markets, bets: markets.map(bet) });
        const utils = await mount(messaging);

        const all = markup(utils.container);
        await pick('bets');
        const myBets = markup(utils.container);
        await pick('markets');
        const myMarkets = markup(utils.container);

        expect(myBets).toBe(all);
        expect(myMarkets).toBe(all);
    });

    it('renders the same card component in the same grid on every tab, differing only in rows', async () => {
        // 1: bet and created, 2: bet only, 3: created only, 4: neither.
        const markets = [market(1, OWN), market(2, OTHER), market(3, OWN), market(4, OTHER)];
        const { messaging } = harness({ markets, bets: [bet(markets[0], 0), bet(markets[1], 1)] });
        const utils = await mount(messaging);

        const seen = {};
        for (const view of ['all', 'bets', 'markets']) {
            await pick(view);
            const ul = list(utils.container);
            expect(ul, view).toBeTruthy();
            expect(ul.className).toBe(listStyles.marketList);
            expect(ul.parentElement.className).toBe(listStyles.cardArea);
            for (const li of ul.children) {
                expect(li.tagName).toBe('LI');
                expect(li.firstElementChild.tagName).toBe('BUTTON');
                expect(li.firstElementChild.className).toBe(cardStyles.card);
            }
            seen[view] = listed(utils.container);
        }

        expect(seen.all).toEqual(['999', '998', '997', '996']);
        expect(seen.bets).toEqual(['999', '998']);
        expect(seen.markets).toEqual(['999', '997']);
        // Each narrowed tab keeps All's order.
        for (const view of ['bets', 'markets']) {
            expect(seen[view]).toEqual(seen.all.filter((id) => seen[view].includes(id)));
        }
        // The same per-user chips ride on the card wherever it is listed.
        expect(screen.getByRole('button', { name: 'Market 1' })).toHaveTextContent('10 XCHAIN');
    });

    it('keeps the same title-line filter on every tab', async () => {
        const markets = [market(1, OWN)];
        const { messaging } = harness({ markets, bets: [bet(markets[0], 0)] });
        await mount(messaging);
        for (const view of ['all', 'bets', 'markets']) {
            await pick(view);
            expect(screen.getByRole('button', { name: 'Filter prediction markets' })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: TAB_NAME[view] })).toHaveAttribute('aria-selected', 'true');
        }
    });

    it('narrows by bet and by creator in marketsForView', () => {
        const rows = [market(1, OWN), market(2, OTHER)];
        const ctx = {
            chainId: CHAIN,
            betsByMarket: new Map([[`${CHAIN}:${rows[1].action_index}`, [bet(rows[1], 0)]]]),
            ownAddresses: new Set([OWN]),
        };
        expect(marketsForView('all', rows, ctx)).toEqual(rows);
        expect(marketsForView('bets', rows, ctx)).toEqual([rows[1]]);
        expect(marketsForView('markets', rows, ctx)).toEqual([rows[0]]);
    });
});

describe('Prediction markets page reads stay bounded', () => {
    async function readsAt(rowCount) {
        // Every market bet in and created by the wallet, so every tab lists
        // all of them: the most rows each tab can carry.
        const markets = Array.from({ length: rowCount }, (_, i) => market(i + 1, OWN));
        const { messaging, counts } = harness({ markets, bets: markets.map(bet) });
        const utils = await mount(messaging);
        expect(listed(utils.container)).toHaveLength(rowCount);
        const onLoad = { ...counts };
        await pick('bets');
        expect(listed(utils.container)).toHaveLength(rowCount);
        const onBets = { ...counts };
        await pick('markets');
        expect(listed(utils.container)).toHaveLength(rowCount);
        const onMarkets = { ...counts };
        cleanup();
        return { onLoad, onBets, onMarkets };
    }

    it('makes the same reads at 2 markets as at 40', async () => {
        const few = await readsAt(2);
        const many = await readsAt(40);

        expect(few.onLoad).toEqual({ getAddressesByChain: 1, betFeeds: 1, bets: 1 });
        expect(many.onLoad).toEqual(few.onLoad);
        // My predictions narrows the rows in hand; it reads nothing.
        expect(few.onBets).toEqual(few.onLoad);
        expect(many.onBets).toEqual(many.onLoad);
        // My markets asks once per wallet address on the network (one here),
        // never once per market.
        expect(few.onMarkets).toEqual({ ...few.onLoad, betFeeds: 2 });
        expect(many.onMarkets).toEqual(few.onMarkets);
        // No market read per bet or per card on any tab.
        expect(many.onMarkets.betFeed).toBeUndefined();
    });

    it('asks My markets once per wallet address, however many markets they created', async () => {
        const second = 'bc1qsecondsecondsecondsecondsecondsecondse';
        const markets = Array.from({ length: 30 }, (_, i) => market(i + 1, i % 2 ? OWN : second));
        const { messaging, counts } = harness({ markets, bets: [], addresses: [OWN, second] });
        const utils = await mount(messaging, 'markets');
        await screen.findByRole('button', { name: 'Market 1' });
        expect(listed(utils.container)).toHaveLength(30);
        // One network read on load, then one creator read per address.
        expect(counts.betFeeds).toBe(1 + 2);
        expect(counts.betFeed).toBeUndefined();
        // Merged newest first, the order All uses.
        expect(listed(utils.container)).toEqual(markets.map((m) => m.action_index));
    });

    it('lists a created market older than the network list on My markets', async () => {
        // The network list (All) answers only the newest market; the wallet
        // created an older one, which My markets still lists.
        const newest = market(1, OTHER);
        const older = market(60, OWN);
        const counts = {};
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OWN }] }),
            betFeeds: vi.fn((req) => {
                counts[req?.type || 'list'] = (counts[req?.type || 'list'] || 0) + 1;
                return Promise.resolve({ data: req?.type === 'source' ? [older] : [newest] });
            }),
            bets: vi.fn().mockResolvedValue({ data: [] }),
        };
        const utils = await mount(messaging);
        expect(listed(utils.container)).toEqual([newest.action_index]);
        await pick('markets');
        await screen.findByRole('button', { name: 'Market 60' });
        expect(listed(utils.container)).toEqual([older.action_index]);
        expect(counts.source).toBe(1);
    });
});
