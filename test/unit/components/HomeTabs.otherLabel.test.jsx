// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's Activity tab names each row by its own action, as History does. An
// action outside the filter buckets (EXECUTE, DEPLOY, STAKE and the rest)
// classifies to the 'other' bucket, and that bucket name is a filter id, not
// a label: the row reads "Contract call" or "Publish contract", never "Other".

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
import { classifyEntryAction } from '../../../packages/core/src/shared/utils/historyFilter.js';
import { actionDisplayLabel } from '../../../packages/core/src/shared/utils/actionDisplayLabel.js';

const CHAINS = [
    { id: 'bitcoin-regtest', coin: 'bitcoin', tick: 'BTC', displayName: 'Bitcoin' },
    { id: 'litecoin-regtest', coin: 'litecoin', tick: 'LTC', displayName: 'Litecoin' },
    { id: 'dogecoin-regtest', coin: 'dogecoin', tick: 'DOGE', displayName: 'Dogecoin' },
];
const descriptors = CHAINS.map((c) => ({ id: c.id, coin: c.coin, displayName: c.displayName, networkKind: 'regtest' }));
const chainRegistry = {
    get: (id) => descriptors.find((d) => d.id === id) || null,
    byCoin: (coin) => descriptors.filter((d) => d.coin === coin),
    all: () => descriptors,
};

function balancesFor(address) {
    return Object.fromEntries(CHAINS.map((c) => [c.id, [{
        address,
        balances: {
            native: { tick: c.tick, quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
    }]]));
}

// The shared row renders the asset mark, then the label cell, whose first
// child is the label; reading it by position keeps the check off the mark,
// amount and time cells.
function rowLabels() {
    return [...document.querySelectorAll('[data-activity-row]')].map((row) => {
        const cell = row.children[1]?.firstElementChild;
        return (cell?.textContent || '').trim();
    });
}

async function openActivity() {
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    localStorage.clear();
});

describe('Home Activity labels for unbucketed actions', () => {
    it('the demo feed for BTC, LTC and DOGE carries contract rows in the other bucket', () => {
        const walletAddresses = new Set(['demo-address']);
        for (const chain of CHAINS) {
            const rows = synthesizeDemoHistory(chain.id, 'demo-address');
            const execute = rows.find((row) => row.action === 'EXECUTE');
            expect(execute, chain.id).toBeTruthy();
            expect(classifyEntryAction({ ...execute, raw: execute }, walletAddresses)).toBe('other');
        }
    });

    it('a demo Activity row never reads "Other" and a contract call reads its own verb', async () => {
        markDemoWallet('demo-wallet');
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={balancesFor('demo-address')}
                walletId="demo-wallet"
                networkFilter="all"
            />,
        );
        await openActivity();
        const labels = rowLabels();
        expect(labels.length).toBeGreaterThan(0);
        expect(labels.every((label) => label.length > 0)).toBe(true);
        expect(labels).not.toContain('Other');
        expect(labels.filter((label) => label === 'Contract call')).toHaveLength(CHAINS.length);
    });

    it('a recent-activity row in the other bucket shows actionDisplayLabel of its action', async () => {
        const address = 'bcrt1qowner';
        const entry = (actionIndex, action) => ({
            key: `bitcoin-regtest|${actionIndex}:${address}`,
            chainId: 'bitcoin-regtest',
            address,
            actionIndex: String(actionIndex),
            action,
            blockIndex: 100 + actionIndex,
            timestamp: 1_800_000_000 + actionIndex,
            txHash: `tx-${actionIndex}`,
            source: address,
            raw: { action, source: address },
            link: null,
        });
        const entries = [entry(1, 'DEPLOY'), entry(2, 'EXECUTE'), entry(3, 'NEW_FUTURE_VERB')];
        for (const e of entries) {
            expect(classifyEntryAction(e, new Set([address]))).toBe('other');
        }
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={balancesFor(address)}
                walletId="real-wallet"
                networkFilter="all"
                recentActivity={entries}
                onActivityOpen={() => {}}
            />,
        );
        await openActivity();
        const labels = rowLabels();
        expect(labels).toHaveLength(3);
        expect(labels).not.toContain('Other');
        expect(labels).toEqual(expect.arrayContaining([
            'Publish contract',
            'Contract call',
            actionDisplayLabel('NEW_FUTURE_VERB'),
        ]));
        expect(actionDisplayLabel('NEW_FUTURE_VERB')).toBe('New future verb');
    });
});
