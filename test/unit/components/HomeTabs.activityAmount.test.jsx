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
    it('prints whole-unit amounts as History does', async () => {
        markDemoWallet('demo-wallet');
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
            />,
        );

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
        const rows = document.querySelectorAll('[data-activity-row]');
        expect(rows.length).toBeGreaterThan(0);
        const texts = [...rows].map((row) => row.textContent);
        expect(texts.some((text) => text.includes('+100 BTC'))).toBe(true);
        expect(texts.some((text) => text.includes('0.000001 BTC'))).toBe(false);
        // Other actions carry base units: the demo sweep of 2500000 is 0.025 BTC.
        expect(texts.some((text) => text.includes('0.025 BTC'))).toBe(true);
        expect(texts.some((text) => text.includes('2,500,000 BTC'))).toBe(false);
    });
});
