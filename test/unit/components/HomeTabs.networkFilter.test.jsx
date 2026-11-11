// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

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
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => ({}),
    useTokenFiatRates: () => ({}),
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const descriptors = new Map([
    ['custom-alpha', {
        id: 'custom-alpha', coin: 'bitcoin', displayName: 'Custom Bitcoin',
        color: '#000000', networkKind: 'mainnet',
    }],
    ['custom-beta', {
        id: 'custom-beta', coin: 'litecoin', displayName: 'Custom Litecoin',
        color: '#000000', networkKind: 'mainnet',
    }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((d) => d.coin === coin),
    all: () => [...descriptors.values()],
};
const balance = (tick) => [{
    address: 'address',
    balances: { native: { tick, quantity: '100000000', divisibility: 8 }, tokens: [] },
}];

afterEach(() => cleanup());

describe('HomeTabs network filtering', () => {
    it('opens one menu with sort, token search, and network controls', () => {
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{ 'custom-alpha': balance('BTC') }}
                walletId="wallet"
                networkFilter="all"
                coinFamilies={['bitcoin', 'litecoin']}
                onNetworkFilterChange={vi.fn()}
                tokenQuery=""
                onTokenQueryChange={vi.fn()}
            />,
        );

        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();
        const button = screen.getByRole('button', { name: 'Filter and sort' });
        expect(screen.getAllByRole('button', { name: 'Filter and sort' })).toHaveLength(1);
        fireEvent.click(button);

        expect(screen.getByRole('radio', { name: 'Name' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Value' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search tokens by name' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Filter by network/ })).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Filter and sort' })).toBeNull();
        expect(button).toHaveFocus();

        fireEvent.click(button);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog', { name: 'Filter and sort' })).toBeNull();
    });

    it('uses registry coin metadata instead of parsing the chain id', () => {
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{ 'custom-alpha': balance('BTC'), 'custom-beta': balance('LTC') }}
                walletId="wallet"
                networkFilter="bitcoin"
            />,
        );

        expect(screen.getByText('Custom Bitcoin')).toBeInTheDocument();
        expect(screen.queryByText('Custom Litecoin')).toBeNull();
    });

    it('labels even a sparse amount list when the all-networks view is active', () => {
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{ 'custom-alpha': balance('BTC') }}
                walletId="wallet"
                networkFilter="all"
            />,
        );

        // A native row's title is its chain's name, so the chain is named
        // once there and the subtitle does not repeat it.
        expect(screen.getByText('Custom Bitcoin', { selector: '[title="Custom Bitcoin"]' })).toBeInTheDocument();
        expect(screen.queryByText('BTC · Custom Bitcoin')).toBeNull();
    });

    it('uses the shared compact row without textual chain badges on Home activity', () => {
        const home = readFileSync('packages/core/src/shared/components/HomeTabs.jsx', 'utf8');
        const dispensers = readFileSync('packages/core/src/shared/routes/DispensersList.jsx', 'utf8');
        const staking = readFileSync('packages/core/src/shared/routes/StakingList.jsx', 'utf8');

        expect(home).toMatch(/<SharedActivityRow/);
        expect(home).not.toMatch(/ChainBadge/);
        // Dispenser and stake rows name their chain through the asset icon's chain overlay.
        expect(dispensers).toMatch(/function DispenserRow[\s\S]*?className=\{local\.chainOverlay\}/);
        expect(dispensers).not.toMatch(/ChainBadge/);
        expect(staking).toMatch(/function StakeRow[\s\S]*?className=\{local\.chainOverlay\}/);
        expect(staking).not.toMatch(/ChainBadge/);
    });

    it('shows a block for confirmed activity and only the time for pending activity', async () => {
        const address = 'bc1qwallet';
        const entry = (key, blockIndex) => ({
            key,
            chainId: 'custom-alpha',
            address,
            actionIndex: key,
            action: 'SEND',
            blockIndex,
            timestamp: 1_800_000_000,
            txHash: `tx-${key}`,
            source: address,
            raw: { amount: '1', tick: 'BTC', destination: 'bc1qpeer' },
            link: null,
        });
        const { container } = render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{ 'custom-alpha': balance('BTC') }}
                walletId="wallet"
                networkFilter="all"
                recentActivity={[entry('confirmed', 123456), entry('pending', 0)]}
                onActivityOpen={() => {}}
            />,
        );

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
        const rows = [...container.querySelectorAll('[data-activity-row]')];
        const confirmed = rows.find((row) => row.textContent.includes('Confirmed'));
        const pending = rows.find((row) => row.textContent.includes('Pending'));
        expect(confirmed).toHaveTextContent('Block 123,456');
        expect(pending).not.toHaveTextContent(/Block/);
        expect(pending.querySelector('time')).not.toBeNull();
    });
});
