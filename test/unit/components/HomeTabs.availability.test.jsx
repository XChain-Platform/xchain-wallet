// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// HomeTabs empty states: one explanation per tab, left to the empty card.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const tabsCss = readFileSync(
    'packages/core/src/shared/components/HomeTabs.module.css',
    'utf8',
);

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
// One object for every render, as the real context provides: HomeTabs reads
// settings through useSettings, whose effects key on the messaging identity,
// so a fresh object per render re-runs them forever.
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => {
    const value = { messaging: {}, shell: 'web' };
    return { useMessaging: () => value };
});
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));
vi.mock('@xchain-wallet/core/flows', () => ({
    isDemoWallet: (walletId) => walletId === 'demo-wallet',
    synthesizeDemoHistory: () => [],
    synthesizeDemoDefiPositions: () => [],
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const chainRegistry = {
    byCoin: () => [],
    get: (chainId) => (chainId === 'bitcoin-mainnet'
        ? { id: chainId, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet' }
        : null),
    all: () => [],
};

function mount(walletId, overrides = {}) {
    return render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{}}
            walletId={walletId}
            networkFilter="all"
            coinFamilies={[]}
            onNetworkFilterChange={() => {}}
            onTokenQueryChange={() => {}}
            {...overrides}
        />,
    );
}

afterEach(() => cleanup());

describe('HomeTabs empty states', () => {
    it('shows one actionable first-funding state for an empty wallet', () => {
        const onReceive = vi.fn();
        const onBuy = vi.fn();
        mount('real-wallet', { onReceive, onBuy });

        expect(screen.getByText('Fund your wallet')).toBeTruthy();
        expect(screen.getByText(/Receive coins from another wallet or buy coins/)).toBeTruthy();
        expect(screen.queryByText('No coins yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        fireEvent.click(screen.getByRole('button', { name: 'Buy coins' }));
        expect(onReceive).toHaveBeenCalledTimes(1);
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('starts addressless wallets with address generation instead of a second empty card', () => {
        const onAddAddress = vi.fn();
        mount('real-wallet', { hasAddresses: false, onAddAddress });

        expect(screen.getAllByText('Fund your wallet')).toHaveLength(1);
        expect(screen.queryByText('No coins yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Generate an address' }));
        expect(onAddAddress).toHaveBeenCalledTimes(1);
    });

    it('shows a pending-only native balance instead of the first-funding card', () => {
        mount('real-wallet', {
            balances: {
                'bitcoin-mainnet': [{
                    address: 'bc1qpending',
                    balances: {
                        native: {
                            tick: 'BTC', quantity: '0', pendingQuantity: '25000000', divisibility: 8,
                        },
                        tokens: [],
                    },
                }],
            },
        });

        expect(screen.queryByText('Fund your wallet')).toBeNull();
        expect(screen.getByTestId('balance-pending')).toHaveTextContent('0.25000000 pending');
    });

    it('shows only the empty card on an empty NFTs tab', () => {
        mount('real-wallet');
        fireEvent.click(screen.getByRole('tab', { name: 'NFTs' }));

        expect(screen.getByText('No collectibles yet')).toBeTruthy();
        expect(screen.queryByText(/can never be split/i)).toBeNull();
    });

    it('keeps the DeFi tab with its empty state for a real wallet', () => {
        mount('real-wallet');
        fireEvent.click(screen.getByRole('tab', { name: 'DeFi' }));

        expect(screen.getByText('No DeFi positions yet')).toBeTruthy();
    });

    it('does not justify placeholder body text', () => {
        const rule = tabsCss.match(/\.placeholderBody\s*\{[^}]*\}/)[0];
        expect(rule).not.toMatch(/text-align:\s*justify/);
    });
});
