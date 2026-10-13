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
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: {}, shell: 'web' }),
}));
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
    get: () => null,
    all: () => [],
};

function mount(walletId) {
    return render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{}}
            walletId={walletId}
            networkFilter="all"
            coinFamilies={[]}
            onNetworkFilterChange={() => {}}
            onTokenQueryChange={() => {}}
        />,
    );
}

afterEach(() => cleanup());

describe('HomeTabs empty states', () => {
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
