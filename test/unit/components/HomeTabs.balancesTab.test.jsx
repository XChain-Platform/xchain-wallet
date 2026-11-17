// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home's three tabs (operator 2026-11-15, every width): Balances (coins and
// tokens in one list, narrowed by the filter popover's Type field), NFTs (a
// grid of large images) and DeFi. The retired All, Coins and Tokens tab
// values map to Balances with the matching Type.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    collectibleKeys: new Set(['bitcoin-mainnet:RAREPEPE']),
    tokenRateCalls: [],
    verifyBalance: vi.fn(() => Promise.resolve({ status: 'verified', reason: null })),
}));

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => {
    const value = { messaging: { verifyBalance: mocks.verifyBalance }, shell: 'web' };
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
    useTokenFiatRates: (opts) => {
        mocks.tokenRateCalls.push({ refreshEnabled: opts.refreshEnabled, tokens: opts.tokens.length });
        return {};
    },
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

import {
    HOME_TABS,
    HomeTabs,
    resolveHomeTab,
} from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { openHomeFilterPanel, openHomeTab, showHomeBalances } from '../../helpers/homeBalances.js';
import { selectOptionDetails } from '../../helpers/selectOption.js';

const descriptors = new Map([
    ['bitcoin-mainnet', { id: 'bitcoin-mainnet', coin: 'bitcoin', displayName: 'Bitcoin', color: '#F7931A', networkKind: 'mainnet' }],
    ['litecoin-mainnet', { id: 'litecoin-mainnet', coin: 'litecoin', displayName: 'Litecoin', color: '#345D9D', networkKind: 'mainnet' }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((d) => d.coin === coin),
    all: () => [...descriptors.values()],
};

function balancesWith(extraTokens = 0) {
    const tokens = [
        { tick: 'XCP', displayName: 'Counterparty', quantity: '310', divisibility: 0, fiatRate: 6 },
        { tick: 'RAREPEPE', displayName: 'Rare Pepe', quantity: '1', divisibility: 0, fiatRate: 420 },
        { tick: 'NOPRICE', displayName: 'Unpriced token', quantity: '9', divisibility: 0 },
    ];
    for (let i = 0; i < extraTokens; i += 1) {
        tokens.push({ tick: `TOK${i}`, displayName: `Token ${i}`, quantity: '5', divisibility: 0, fiatRate: 1 });
    }
    return {
        'bitcoin-mainnet': [{
            address: 'bc1-address',
            balances: { native: { tick: 'BTC', quantity: '2', divisibility: 0, fiatRate: 100 }, tokens },
        }],
        'litecoin-mainnet': [{
            address: 'ltc-address',
            balances: { native: { tick: 'LTC', quantity: '3', divisibility: 0, fiatRate: 10 }, tokens: [] },
        }],
    };
}

function mount(props = {}, balances = balancesWith()) {
    return render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={balances}
            walletId={props.walletId || 'wallet-tabs'}
            networkFilter="all"
            tokenQuery=""
            coinFamilies={['bitcoin', 'litecoin']}
            onNetworkFilterChange={vi.fn()}
            onTokenQueryChange={vi.fn()}
            onSelectToken={vi.fn()}
            defiPositions={[]}
            {...props}
        />,
    );
}

const shownKeys = () => [...document.querySelectorAll('[data-balance-key]')]
    .map((row) => row.getAttribute('data-balance-key'));
const typeField = () => within(openHomeFilterPanel()).getByRole('button', { name: /^Type/ });

beforeEach(() => {
    globalThis.localStorage?.clear();
    mocks.tokenRateCalls = [];
    mocks.verifyBalance.mockClear();
});

afterEach(() => {
    cleanup();
});

describe('Home tabs', () => {
    it('shows three tabs, Balances, NFTs and DeFi, with Balances chosen', () => {
        mount();
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['Balances', 'NFTs', 'DeFi']);
        expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
        // Toggles hold at most four tabs.
        expect(HOME_TABS).toHaveLength(3);
        expect(screen.getByRole('tablist', { name: 'Wallet view' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Balances' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'NFTs' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'DeFi' })).toBeInTheDocument();
        for (const retired of ['All', 'Coins', 'Tokens', 'Activity']) {
            expect(screen.queryByRole('tab', { name: retired })).toBeNull();
        }
    });

    it('lists coins, then tokens (NFTs included), in one Balances list', () => {
        mount();
        // Name order (the default sort) within each group.
        expect(shownKeys()).toEqual([
            'bitcoin-mainnet:BTC', 'litecoin-mainnet:LTC',
            'bitcoin-mainnet:XCP', 'bitcoin-mainnet:RAREPEPE', 'bitcoin-mainnet:NOPRICE',
        ]);
    });

    it('opens an unpriced token at its real rate, not the zero the list shows', () => {
        const onSelectToken = vi.fn();
        mount({ onSelectToken });
        fireEvent.click(screen.getByRole('button', { name: /^Open Unpriced token details/ }));
        expect(onSelectToken).toHaveBeenCalledWith(expect.objectContaining({ tick: 'NOPRICE', fiatRate: null }));
        fireEvent.click(screen.getByRole('button', { name: /^Open Counterparty details/ }));
        expect(onSelectToken).toHaveBeenLastCalledWith(expect.objectContaining({ tick: 'XCP', fiatRate: 6 }));
    });
});

describe('Balances Type filter', () => {
    it('is the themed dropdown with All types, Coins and Tokens, each with an icon, All types by default', () => {
        mount();
        const field = typeField();
        expect(field.tagName).toBe('BUTTON');
        expect(field).toHaveAttribute('aria-haspopup', 'listbox');
        expect(document.querySelector('select')).toBeNull();
        expect(screen.queryAllByRole('radio')).toEqual([]);
        expect(field).toHaveTextContent('All types');
        // The field names itself with its selection, like every filter dropdown.
        expect(field).toHaveAccessibleName('Type: All types');
        const options = selectOptionDetails(field);
        expect(options.map((o) => [o.value, o.label])).toEqual([
            ['all', 'All types'], ['coins', 'Coins'], ['tokens', 'Tokens'],
        ]);
        fireEvent.click(field);
        const listbox = screen.getByRole('listbox');
        for (const option of within(listbox).getAllByRole('option')) {
            expect(option.querySelector('svg')).not.toBeNull();
        }
    });

    it('keeps the existing filter options beside it: search, sort and network', () => {
        mount();
        const panel = openHomeFilterPanel();
        expect(within(panel).getByRole('searchbox')).toBeInTheDocument();
        expect(within(panel).getByRole('button', { name: /^Sort/ })).toBeInTheDocument();
        expect(within(panel).getByRole('button', { name: /^Type/ })).toBeInTheDocument();
        expect(within(panel).getByText(/network/i)).toBeInTheDocument();
    });

    it('narrows the list to coins or tokens and marks the filter button active', () => {
        mount();
        showHomeBalances('coins');
        expect(shownKeys()).toEqual(['bitcoin-mainnet:BTC', 'litecoin-mainnet:LTC']);
        // A Type other than All types counts as a filter on the button.
        expect(screen.getByRole('button', { name: 'Filter and sort' }).className).toMatch(/triggerActive/);
        showHomeBalances('tokens');
        expect(shownKeys()).toEqual(['bitcoin-mainnet:XCP', 'bitcoin-mainnet:RAREPEPE', 'bitcoin-mainnet:NOPRICE']);
        expect(typeField()).toHaveAccessibleName('Type: Tokens');
        fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
        showHomeBalances('all');
        expect(shownKeys()).toHaveLength(5);
        expect(screen.getByRole('button', { name: 'Filter and sort' }).className).not.toMatch(/triggerActive/);
    });

    it('offers the Type only on Balances', () => {
        mount();
        openHomeTab('NFTs');
        expect(within(openHomeFilterPanel()).queryByRole('button', { name: /^Type/ })).toBeNull();
    });

    it('is remembered per wallet', () => {
        const { unmount } = mount({ walletId: 'wallet-a' });
        showHomeBalances('tokens');
        unmount();
        mount({ walletId: 'wallet-a' });
        expect(shownKeys()).toHaveLength(3);
        cleanup();
        mount({ walletId: 'wallet-b' });
        expect(shownKeys()).toHaveLength(5);
    });
});

describe('retired tab values', () => {
    it.each([
        ['all', { tab: 'balances', type: 'all' }],
        ['coins', { tab: 'balances', type: 'coins' }],
        ['tokens', { tab: 'balances', type: 'tokens' }],
        ['activity', { tab: 'balances' }],
        ['balances', { tab: 'balances' }],
        ['nfts', { tab: 'nfts' }],
        ['defi', { tab: 'defi' }],
        [undefined, { tab: 'balances' }],
        ['bogus', { tab: 'balances' }],
    ])('maps %s to %o', (value, expected) => {
        expect(resolveHomeTab(value)).toEqual(expected);
    });
});

describe('NFTs tab', () => {
    it('shows the NFTs as a large image grid with the name under each and no balance', () => {
        const onSelectToken = vi.fn();
        mount({ onSelectToken });
        openHomeTab('NFTs');
        const grid = screen.getByRole('list', { name: /collectibles/i });
        expect(grid.closest('[data-size]')).toHaveAttribute('data-size', 'large');
        const cards = within(grid).getAllByRole('listitem');
        expect(cards).toHaveLength(1);
        expect(cards[0]).toHaveTextContent('Rare Pepe');
        // The name alone: no ticker line and no balance or value.
        expect(cards[0]).not.toHaveTextContent('RAREPEPE');
        expect(cards[0]).not.toHaveTextContent('$');
        expect(document.querySelector('[data-balance-key]')).toBeNull();
        fireEvent.click(within(cards[0]).getByRole('button', { name: /^Open Rare Pepe details/ }));
        expect(onSelectToken).toHaveBeenCalledWith(expect.objectContaining({ tick: 'RAREPEPE' }));
    });
});

describe('DeFi tab', () => {
    it('keeps its open positions list', () => {
        mount({
            defiPositions: [{
                id: 'order', kind: 'order', action: 'ORDER', status: 'confirmed', title: 'ORDER position',
                primary: '1', secondary: '', badge: 'Open', blockIndex: 12_000, timestamp: 1_760_000_000,
                confirms: 5, chainId: 'bitcoin-mainnet', address: 'owner', actionIndex: '4', tick: 'XCP',
            }],
            onSelectEntry: vi.fn(),
        });
        openHomeTab('DeFi');
        expect(document.querySelectorAll('[data-activity-row]').length).toBe(1);
    });
});

describe('Balances reads', () => {
    it('prices tokens in one batch and checks no per-token proof on the default Balances view, at 5 and 35 rows alike', () => {
        const runs = [];
        for (const extra of [0, 30]) {
            mocks.tokenRateCalls = [];
            mocks.verifyBalance.mockClear();
            const { unmount } = mount({ verifyProofsEnabled: true }, balancesWith(extra));
            runs.push({
                // One batched rate hook (its reads follow the chains; see
                // HomeTabs.bulkTokenPrices), refreshing under All types.
                refresh: mocks.tokenRateCalls.every((call) => call.refreshEnabled),
                // The explorer has no bulk proof route, so none runs here.
                proofs: mocks.verifyBalance.mock.calls.length,
            });
            unmount();
        }
        expect(runs[0]).toEqual({ refresh: true, proofs: 0 });
        expect(runs[1]).toEqual(runs[0]);
    });

    it('keeps token prices refreshing for every Type', () => {
        mount({ verifyProofsEnabled: true });
        for (const type of ['coins', 'tokens', 'all']) {
            showHomeBalances(type);
            expect(mocks.tokenRateCalls.at(-1).refreshEnabled).toBe(true);
        }
    });
});
