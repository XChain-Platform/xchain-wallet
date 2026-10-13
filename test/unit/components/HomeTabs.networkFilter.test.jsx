// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

        expect(screen.getByText('BTC · Custom Bitcoin')).toBeInTheDocument();
    });

    it('keeps textual chain badges on cross-chain amount rows', () => {
        const home = readFileSync('packages/core/src/shared/components/HomeTabs.jsx', 'utf8');
        const dispensers = readFileSync('packages/core/src/shared/routes/DispensersList.jsx', 'utf8');
        const staking = readFileSync('packages/core/src/shared/routes/StakingList.jsx', 'utf8');

        expect(home).toMatch(/function ActivityRow[\s\S]*?<ChainBadge descriptor=\{descriptor\}/);
        expect(home).toMatch(/function DemoDefiList[\s\S]*?<ChainBadge descriptor=\{chainRegistry\.get\(p\.chainId\)\}/);
        expect(dispensers).toMatch(/function DispenserRow[\s\S]*?<ChainBadge descriptor=\{descriptor\}/);
        expect(staking).toMatch(/function StakeRow[\s\S]*?<ChainBadge descriptor=\{descriptor\}/);
    });
});
