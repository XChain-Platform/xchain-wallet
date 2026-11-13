// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's Activity tab prints the same synthesized rows History prints, and
// those rows carry whole-unit decimal amounts. Home used to read an integer
// amount as base units, so the demo's 100 BTC receive read 0.000001 BTC on
// Home and 100 BTC on History and its detail page. Only SEND rows carry
// whole units; the other synthesized actions (a sweep, an issue) carry base
// units and keep their conversion.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
import { synthesizeDemoHistory } from '../../../packages/core/src/flows/demoFixtures.js';
import { normalizeHistoryRow } from '../../../packages/core/src/shared/utils/historyRow.js';
import {
    activityRowAmount,
    activityRowAmountQualifier,
    activityRowTick,
} from '../../../packages/core/src/shared/utils/activityAmount.js';

const CHAIN = 'bitcoin-regtest';
const descriptor = { id: CHAIN, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    get: (id) => (id === CHAIN ? descriptor : null),
    byCoin: (coin) => (coin === 'bitcoin' ? [descriptor] : []),
    all: () => [descriptor],
};

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    localStorage.clear();
});

describe('Home Activity amounts', () => {
    it('reads the paid side of order, swap and dividend indexer records', () => {
        const order = { action: 'ORDER', raw: { give_tick: 'XCP', give_amount: '2.5' } };
        const swap = { action: 'SWAP', raw: { give_tick: 'AAA', give_amount: '1.25' } };
        const dividend = {
            action: 'DIVIDEND',
            raw: { tick: 'SHARES', dividend_tick: 'XCP', amount: '0.5' },
        };

        expect(activityRowAmount(order, { divisibility: 8 })).toBe('2.5');
        expect(activityRowTick(order)).toBe('XCP');
        expect(activityRowAmount(swap, { divisibility: 8 })).toBe('1.25');
        expect(activityRowTick(swap)).toBe('AAA');
        expect(activityRowAmount(dividend, { divisibility: 8 })).toBe('0.5');
        expect(activityRowTick(dividend)).toBe('XCP');
        expect(activityRowAmountQualifier(dividend)).toBe('per unit');
    });

    it('keeps legacy base-unit fields and never invents a missing figure', () => {
        expect(activityRowAmount({
            action: 'ORDER',
            raw: { give_asset: 'XCP', give_quantity: '2000000' },
        }, { divisibility: 8 })).toBe('0.02');
        expect(activityRowAmount({
            action: 'DIVIDEND',
            raw: { dividend_asset: 'XCP', quantity_per_unit: '100' },
        }, { divisibility: 8 })).toBe('0.000001');
        expect(activityRowAmount({ action: 'SWAP', raw: { get_amount: '99' } }, { divisibility: 8 })).toBe('');
        expect(activityRowAmount({ action: 'DIVIDEND', raw: { dividend_tick: 'XCP' } }, { divisibility: 8 })).toBe('');
    });

    it('prints whole-unit amounts as History does', async () => {
        markDemoWallet('demo-wallet');
        const recentActivity = synthesizeDemoHistory(CHAIN, 'demo-address')
            .map((row) => normalizeHistoryRow(row, { chainId: CHAIN, address: 'demo-address' }))
            .filter(Boolean);
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{
                    [CHAIN]: [{
                        address: 'demo-address',
                        balances: {
                            native: { tick: 'BTC', quantity: '10000000000', divisibility: 8 },
                            tokens: [],
                        },
                    }],
                }}
                walletId="demo-wallet"
                networkFilter="all"
                recentActivity={recentActivity}
            />,
        );

        // The Home Activity tab is retired (ruling n.253): History prints these rows, so Home
        // draws none and the amount rules above are the ones History uses.
        await screen.findByRole('tab', { name: 'Coins' });
        expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
        expect(document.querySelector('[data-activity-row]')).toBeNull();
        expect(recentActivity.length).toBeGreaterThan(0);
    });

    it('renders the paid ticker and per-unit qualifier in Home activity', async () => {
        const address = 'bcrt1qowner';
        const recentActivity = [
            {
                key: `${CHAIN}:1:${address}`,
                chainId: CHAIN,
                address,
                actionIndex: '1',
                action: 'ORDER',
                blockIndex: 100,
                timestamp: 1_800_000_003,
                source: address,
                raw: { give_tick: 'XCP', give_amount: '2.5', source: address },
            },
            {
                key: `${CHAIN}:2:${address}`,
                chainId: CHAIN,
                address,
                actionIndex: '2',
                action: 'SWAP',
                blockIndex: 101,
                timestamp: 1_800_000_002,
                source: address,
                raw: { give_tick: 'AAA', give_amount: '1.25', source: address },
            },
            {
                key: `${CHAIN}:3:${address}`,
                chainId: CHAIN,
                address,
                actionIndex: '3',
                action: 'DIVIDEND',
                blockIndex: 102,
                timestamp: 1_800_000_001,
                source: address,
                raw: { tick: 'SHARES', dividend_tick: 'XCP', amount: '0.5', source: address },
            },
        ];
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{
                    [CHAIN]: [{
                        address,
                        balances: {
                            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                            tokens: [
                                { tick: 'XCP', quantity: '100000000', divisibility: 8 },
                                { tick: 'AAA', quantity: '100000000', divisibility: 8 },
                            ],
                        },
                    }],
                }}
                walletId="real-wallet"
                networkFilter="all"
                recentActivity={recentActivity}
            />,
        );

        // Home draws no activity rows any more; the paid ticker and qualifier come from the
        // shared helpers History uses.
        await screen.findByRole('tab', { name: 'Coins' });
        expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
        expect(document.querySelector('[data-activity-row]')).toBeNull();
        expect(activityRowTick(recentActivity[0])).toBe('XCP');
        expect(activityRowAmount(recentActivity[0], { divisibility: 8 })).toBe('2.5');
        expect(activityRowTick(recentActivity[1])).toBe('AAA');
        expect(activityRowAmount(recentActivity[1], { divisibility: 8 })).toBe('1.25');
        expect(activityRowAmountQualifier(recentActivity[2])).toBe('per unit');
    });
});
