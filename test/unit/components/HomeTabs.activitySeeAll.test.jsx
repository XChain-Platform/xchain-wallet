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

function renderActivity(props) {
    render(
        <HomeTabs
            chainRegistry={chainRegistry}
            networkFilter="all"
            {...props}
        />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    return screen.getByRole('tabpanel');
}

function expectTrailingSeeAll(panel, onHistory) {
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(panel.querySelector('[data-activity-row]')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'See all activity' });
    expect(panel.lastElementChild).toBe(button);
    expect(button.classList.contains(buttonStyles.block)).toBe(true);
    expect(button.classList.contains(buttonStyles.success)).toBe(true);
    expect(button.classList.contains(buttonStyles.primary)).toBe(false);
    expect(button.classList.contains(buttonStyles.link)).toBe(false);
    const icon = button.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon.querySelectorAll('path')).toHaveLength(3);
    expect(icon.querySelector('path')?.getAttribute('d')).toBe('M3 12a9 9 0 1 0 3-6.7');
    fireEvent.click(button);
    expect(onHistory).toHaveBeenCalledTimes(1);
}

describe('Home Activity tab See all activity', () => {
    it('ends a real wallet\'s rows with a full-width success button and no intro note', () => {
        const onHistory = vi.fn();
        const panel = renderActivity({
            balances: {},
            walletId: 'wallet-real',
            recentActivity: [entry(1), entry(2), entry(3)],
            onHistory,
        });
        expectTrailingSeeAll(panel, onHistory);
    });

    it('ends the demo wallet\'s rows with the same button', () => {
        markDemoWallet('demo-wallet');
        const onHistory = vi.fn();
        const panel = renderActivity({
            balances: demoBalances,
            walletId: 'demo-wallet',
            recentActivity: [entry(1), entry(2)],
            onHistory,
        });
        expectTrailingSeeAll(panel, onHistory);
    });

    it('shows the same success button under the empty state', () => {
        const onHistory = vi.fn();
        const panel = renderActivity({
            balances: {},
            walletId: 'wallet-real',
            recentActivity: [],
            onHistory,
        });
        expect(screen.getByText('No activity yet')).toBeTruthy();
        const button = screen.getByRole('button', { name: 'See all activity' });
        expect(panel.lastElementChild).toBe(button);
        expect(button.classList.contains(buttonStyles.success)).toBe(true);
        expect(button.querySelector('svg')).not.toBeNull();
    });

    it('renders no button without an onHistory handler', () => {
        renderActivity({ balances: {}, walletId: 'wallet-real', recentActivity: [entry(1)] });
        expect(document.querySelector('[data-activity-row]')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'See all activity' })).toBeNull();
        expect(screen.queryByText(NOTE)).toBeNull();
    });

    it('renders no button on the demo list without an onHistory handler', () => {
        markDemoWallet('demo-wallet');
        renderActivity({ balances: demoBalances, walletId: 'demo-wallet', recentActivity: [entry(1)] });
        expect(document.querySelector('[data-activity-row]')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'See all activity' })).toBeNull();
    });
});
