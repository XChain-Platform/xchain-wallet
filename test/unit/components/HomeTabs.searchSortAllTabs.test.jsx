// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Home filter panel's search, sort and network controls act on every tab:
// search keeps the rows whose visible text matches, the network filter keeps
// one chain's rows, sort reorders the balance and DeFi tabs, and a search
// that matches nothing shows No matches with Clear filter. There is no
// Activity tab; History holds that list.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    collectibleKeys: new Set(['bitcoin-mainnet:PEPEA', 'bitcoin-mainnet:FROGB', 'litecoin-mainnet:LTCART']),
}));

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => {
    const value = { messaging: {}, shell: 'web' };
    return { useMessaging: () => value };
});
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => {
    const value = { settings: {}, loading: false };
    return { useSettings: () => value };
});
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => mocks.collectibleKeys,
}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => ({}),
    useTokenFiatRates: () => ({}),
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { sortDefiPositions } from '../../../packages/core/src/shared/utils/homeListFilter.js';

const descriptors = new Map([
    ['bitcoin-mainnet', { id: 'bitcoin-mainnet', coin: 'bitcoin', displayName: 'Zeta coin', color: '#111111', networkKind: 'mainnet' }],
    ['litecoin-mainnet', { id: 'litecoin-mainnet', coin: 'litecoin', displayName: 'Alpha coin', color: '#222222', networkKind: 'mainnet' }],
    ['dogecoin-mainnet', { id: 'dogecoin-mainnet', coin: 'dogecoin', displayName: 'Beta coin', color: '#333333', networkKind: 'mainnet' }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((d) => d.coin === coin),
    all: () => [...descriptors.values()],
};

function holding(native, tokens = []) {
    return [{ address: `${native.tick}-address`, balances: { native: { divisibility: 0, ...native }, tokens } }];
}

// Coin values: Zeta 50, Alpha 30, Beta 20, so value order differs from name order.
const balances = {
    'bitcoin-mainnet': holding({ tick: 'BTC', quantity: '5', fiatRate: 10 }, [
        { tick: 'ZED', displayName: 'Zulu token', quantity: '3', divisibility: 0, fiatRate: 1 },
        { tick: 'BETA', displayName: 'Beta token', quantity: '1', divisibility: 0, fiatRate: 100 },
        { tick: 'PEPEA', displayName: 'Pepe art', quantity: '1', divisibility: 0 },
        { tick: 'FROGB', displayName: 'Frog art', quantity: '1', divisibility: 0, fiatRate: 7 },
    ]),
    'litecoin-mainnet': holding({ tick: 'LTC', quantity: '3', fiatRate: 10 }, [
        { tick: 'LTCART', displayName: 'Lite art', quantity: '1', divisibility: 0 },
        { tick: 'LTOK', displayName: 'Lite token', quantity: '1', divisibility: 0 },
    ]),
    'dogecoin-mainnet': holding({ tick: 'DOGE', quantity: '2', fiatRate: 10 }),
};

const OWN = 'bc1qownaddress';
function activity(i, action, chainId, raw) {
    return {
        key: `${chainId}:${i}:${OWN}`, chainId, address: OWN, actionIndex: String(i), action,
        blockIndex: 800_000 + i, timestamp: 1_760_000_000 + i * 60, txHash: `tx${i}`,
        source: OWN, raw: { action, source: OWN, ...raw }, link: null,
    };
}
const recentActivity = [
    activity(1, 'SEND', 'bitcoin-mainnet', { tick: 'BTC', quantity: '1', destination: 'bc1qfriendcounterpartyzz' }),
    activity(2, 'ISSUANCE', 'bitcoin-mainnet', { tick: 'PEPEA', quantity: '1' }),
    activity(3, 'SEND', 'litecoin-mainnet', { tick: 'LTC', quantity: '1', destination: 'ltc1qelsewhere' }),
];

function position(id, action, actionIndex, timeAgo, extra = {}) {
    return {
        id, kind: action.toLowerCase(), action, status: 'confirmed', title: `${action} position`,
        primary: '1', secondary: '', badge: 'Open', blockIndex: 12_000, timestamp: 1_760_000_000 - timeAgo,
        confirms: 5, chainId: 'bitcoin-mainnet', address: 'owner', actionIndex, ...extra,
    };
}
// Newest first by time: stake, dispenser, contract, order, swap.
const defiPositions = [
    position('stake', 'STAKE', '1', 60),
    position('dispenser', 'DISPENSER', '2', 120, { tick: 'DEMOCOIN', fiatValue: 5 }),
    position('contract', 'CONTRACT', '3', 180, { tick: 'BTC' }),
    position('order', 'ORDER', '4', 240, { tick: 'RAREPEPE', fiatValue: 50 }),
    position('swap', 'SWAP', '5', 300, { tick: 'RAREPEPE', chainId: 'litecoin-mainnet' }),
];

function mount(props = {}) {
    const onSelectEntry = vi.fn();
    const onTokenQueryChange = vi.fn();
    const view = render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={balances}
            walletId={props.walletId || 'wallet-search'}
            networkFilter="all"
            tokenQuery=""
            coinFamilies={['bitcoin', 'litecoin', 'dogecoin']}
            onNetworkFilterChange={vi.fn()}
            onTokenQueryChange={onTokenQueryChange}
            onSelectToken={vi.fn()}
            onSelectEntry={onSelectEntry}
            recentActivity={recentActivity}
            defiPositions={defiPositions}
            {...props}
        />,
    );
    return { ...view, onSelectEntry, onTokenQueryChange };
}

function openTab(name) {
    fireEvent.click(screen.getByRole('tab', { name }));
}

// Balance rows carry their chain:tick key; collectible cards are named
// "Open <name> details".
function shownTicks() {
    return [...document.querySelectorAll('[data-balance-key]')]
        .map((row) => row.getAttribute('data-balance-key').split(':')[1]);
}

function shownNames() {
    return screen.queryAllByRole('button', { name: /^Open .+ details$/ })
        .map((button) => button.getAttribute('aria-label').replace(/^Open (.+) details$/, '$1'));
}

function shownEntryIndexes(onSelectEntry) {
    onSelectEntry.mockClear();
    document.querySelectorAll('[data-activity-row]').forEach((row) => fireEvent.click(row));
    return onSelectEntry.mock.calls.map(([entry]) => entry.actionIndex);
}

function openPanel() {
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    return screen.getByRole('dialog', { name: 'Filter and sort' });
}

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear();
});

describe('Home search on every tab', () => {
    it('filters Coins by coin name and by ticker', () => {
        const { rerender } = mount({ tokenQuery: 'alpha' });
        expect(shownTicks()).toEqual(['LTC']);
        rerender(
            <HomeTabs chainRegistry={chainRegistry} balances={balances} walletId="wallet-search" networkFilter="all"
                tokenQuery="doge" onNetworkFilterChange={vi.fn()} onTokenQueryChange={vi.fn()} onSelectToken={vi.fn()} />,
        );
        expect(shownTicks()).toEqual(['DOGE']);
    });

    it('filters Tokens by token name and ticker', () => {
        const { rerender } = mount({ tokenQuery: 'zulu' });
        openTab('Tokens');
        expect(shownTicks()).toEqual(['ZED']);
        rerender(
            <HomeTabs chainRegistry={chainRegistry} balances={balances} walletId="wallet-search" networkFilter="all"
                tokenQuery="ltok" onNetworkFilterChange={vi.fn()} onTokenQueryChange={vi.fn()} onSelectToken={vi.fn()} />,
        );
        expect(shownTicks()).toEqual(['LTOK']);
    });

    it('filters NFTs by collectible name and token', () => {
        mount({ tokenQuery: 'pepe' });
        openTab('NFTs');
        expect(shownNames()).toEqual(['Pepe art']);
    });

    it('filters DeFi by position name and token', () => {
        const { onSelectEntry } = mount({ tokenQuery: 'democoin' });
        openTab('DeFi');
        expect(shownEntryIndexes(onSelectEntry)).toEqual(['2']);
    });

    it('has no Activity tab, because History holds the same list', () => {
        mount();
        expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Coins', 'Tokens', 'NFTs', 'DeFi']);
    });

    it.each([
        ['Coins', 'Search coins'],
        ['Tokens', 'Search tokens'],
        ['NFTs', 'Search NFTs'],
        ['DeFi', 'Search DeFi'],
    ])('the %s search box names its tab', (tab, copy) => {
        mount();
        openTab(tab);
        const panel = openPanel();
        const input = within(panel).getByRole('searchbox', { name: `${copy} by name` });
        expect(input.getAttribute('placeholder')).toMatch(new RegExp(`^${copy}`));
    });

    it.each(['Coins', 'Tokens', 'NFTs', 'DeFi'])(
        'a %s search that matches nothing shows No matches with Clear filter',
        (tab) => {
            const { onTokenQueryChange } = mount({ tokenQuery: 'nothing-matches-this' });
            openTab(tab);
            expect(screen.getByText(/^No match/)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'Clear Filter' }));
            expect(onTokenQueryChange).toHaveBeenCalledWith('');
        },
    );
});

describe('Home network filter on every tab', () => {
    it('keeps only the chosen network on each tab', () => {
        const { onSelectEntry } = mount({ networkFilter: 'litecoin' });
        expect(shownTicks()).toEqual(['LTC']);
        openTab('Tokens');
        expect(shownTicks()).toEqual(['LTCART', 'LTOK']);
        openTab('NFTs');
        expect(shownNames()).toEqual(['Lite art']);
        openTab('DeFi');
        expect(shownEntryIndexes(onSelectEntry)).toEqual(['5']);
    });
});

describe('Home sort', () => {
    function chooseSort(label) {
        const panel = openPanel();
        fireEvent.click(within(panel).getByRole('button', { name: /^Sort/ }));
        fireEvent.click(within(panel).getByRole('option', { name: label }));
        fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    }

    it('reorders Coins, Tokens and NFTs by name and by value from the panel', () => {
        mount({ walletId: 'wallet-sort-balances' });
        expect(shownTicks()).toEqual(['LTC', 'DOGE', 'BTC']);
        chooseSort('Sort by value');
        expect(shownTicks()).toEqual(['BTC', 'LTC', 'DOGE']);
        openTab('Tokens');
        // Priced rows by value first, then unpriced rows by name.
        expect(shownTicks()).toEqual(['BETA', 'FROGB', 'ZED', 'LTCART', 'LTOK', 'PEPEA']);
        openTab('NFTs');
        expect(shownNames()).toEqual(['Frog art', 'Lite art', 'Pepe art']);
        chooseSort('Sort by name');
        expect(shownNames()).toEqual(['Frog art', 'Lite art', 'Pepe art']);
        openTab('Tokens');
        expect(shownTicks()).toEqual(['BETA', 'FROGB', 'LTCART', 'LTOK', 'PEPEA', 'ZED']);
    });

    it('reorders DeFi by name and by value', () => {
        const { onSelectEntry } = mount({ walletId: 'wallet-sort-defi' });
        openTab('DeFi');
        // Name: Contract, Dispenser, Order, Stake, Swap.
        expect(shownEntryIndexes(onSelectEntry)).toEqual(['3', '2', '4', '1', '5']);
        chooseSort('Sort by value');
        // Valued rows largest first, then the rest by name.
        expect(shownEntryIndexes(onSelectEntry)).toEqual(['4', '2', '3', '1', '5']);
    });

    it('sorts DeFi rows without a value after valued rows', () => {
        const sorted = sortDefiPositions(defiPositions, 'value').map((p) => p.id);
        expect(sorted.slice(0, 2)).toEqual(['order', 'dispenser']);
    });
});
