// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's Activity tab opens straight on its rows, with no intro sentence,
// and ends with one full-width success "See all activity" button that opens
// History. Empty activity ends with the same button.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
    messaging: { getNativePricesRequest: () => Promise.resolve({ prices: {} }) },
    settings: { settings: {}, loading: false },
    collectibles: new Set(),
    rates: {},
}));

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocks.messaging, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => mocks.settings,
}));
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => mocks.collectibles,
}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => mocks.rates,
    useTokenFiatRates: () => mocks.rates,
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qseeallactivityaddress';
const descriptor = { id: CHAIN, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    get: (id) => (id === CHAIN ? descriptor : null),
    byCoin: (coin) => (coin === 'bitcoin' ? [descriptor] : []),
    all: () => [descriptor],
};

const NOTE = 'Your newest actions, newest first.';

function entry(i) {
    return {
        key: `${CHAIN}:${i}:${ADDRESS}`,
        chainId: CHAIN,
        address: ADDRESS,
        actionIndex: String(i),
        action: 'SEND',
        blockIndex: 1_000 + i,
        timestamp: 1_760_000_000 + i * 60,
        txHash: `tx${i}`,
        source: ADDRESS,
        raw: { action: 'SEND', tick: 'BTC', quantity: '1', source: ADDRESS },
        link: null,
    };
}

const demoBalances = {
    [CHAIN]: [{
        address: 'demo-address',
        balances: {
            native: { tick: 'BTC', quantity: '10000000000', divisibility: 8 },
            tokens: [],
        },
    }],
};

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    localStorage.clear();
});

function renderHome(props) {
    render(
        <HomeTabs
            chainRegistry={chainRegistry}
            networkFilter="all"
            {...props}
        />,
    );
}

// The Home Activity tab is retired (ruling n.253): History covers it, so Home
// offers Coins, Tokens, NFTs and DeFi only and never draws activity rows or
// the See all activity button.
function expectNoActivityTab() {
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent.trim())).toEqual(
        expect.not.arrayContaining(['Activity']),
    );
    expect(document.querySelector('[data-activity-row]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'See all activity' })).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
}

describe('Home has no Activity tab', () => {
    it('offers no Activity tab or See all activity button for a real wallet', () => {
        renderHome({
            balances: {},
            walletId: 'wallet-real',
            recentActivity: [entry(1), entry(2), entry(3)],
            onHistory: vi.fn(),
        });
        expectNoActivityTab();
    });

    it('offers none for the demo wallet either', () => {
        markDemoWallet('demo-wallet');
        renderHome({
            balances: demoBalances,
            walletId: 'demo-wallet',
            recentActivity: [entry(1), entry(2)],
            onHistory: vi.fn(),
        });
        expectNoActivityTab();
    });

    it('shows no activity empty state with an empty recent list', () => {
        renderHome({
            balances: {},
            walletId: 'wallet-real',
            recentActivity: [],
            onHistory: vi.fn(),
        });
        expectNoActivityTab();
        expect(screen.queryByText('No activity yet')).toBeNull();
    });

    it('stays without an Activity tab when no onHistory handler is wired', () => {
        renderHome({ balances: {}, walletId: 'wallet-real', recentActivity: [entry(1)] });
        expectNoActivityTab();
    });

    it('opens on Coins', () => {
        renderHome({ balances: {}, walletId: 'wallet-real', recentActivity: [entry(1)], onHistory: vi.fn() });
        const selected = screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');
        expect(selected?.textContent).toMatch(/Coins/);
    });
});
