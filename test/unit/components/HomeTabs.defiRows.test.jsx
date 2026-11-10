// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The demo DeFi tab draws its rows with the shared activity row, so a DeFi
// row reads like a Home activity or History row: a status badge from the
// row's own labels, no confirmation-count pill and no "Unconfirmed" text.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

const NOW = 1_760_000_000;
const positions = vi.hoisted(() => [
    {
        id: 'stake-confirmed', kind: 'stake', action: 'STAKE', status: 'confirmed',
        title: 'XCHAIN stake', primary: '50,000.00000000 XCHAIN', secondary: '', badge: 'Active',
        blockIndex: 12_420, timestamp: 1_760_000_000 - 60, confirms: 8,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet',
    },
    {
        id: 'dispenser-pending', kind: 'dispenser', action: 'DISPENSER', status: 'pending',
        title: 'DEMOCOIN dispenser', primary: '500 DEMOCOIN remaining', secondary: '', badge: 'Open',
        blockIndex: null, timestamp: 1_760_000_000 - 120, confirms: 0,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'DEMOCOIN',
    },
    {
        id: 'contract-failed', kind: 'contract', action: 'CONTRACT', status: 'failed',
        title: 'BTC vault contract', primary: '0.25 BTC locked', secondary: '', badge: 'Vault',
        blockIndex: 12_395, timestamp: 1_760_000_000 - 180, confirms: 27,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'BTC',
    },
]);
vi.mock('@xchain-wallet/core/flows', () => ({
    isDemoWallet: (walletId) => walletId === 'demo-wallet',
    synthesizeDemoHistory: () => [],
    synthesizeDemoDefiPositions: () => positions,
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const chainRegistry = {
    byCoin: () => [],
    get: (chainId) => (chainId === 'bitcoin-mainnet'
        ? { id: chainId, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet' }
        : null),
    all: () => [],
};

afterEach(() => cleanup());

function mountDefi(onSelectEntry = vi.fn()) {
    const view = render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{}}
            walletId="demo-wallet"
            networkFilter="all"
            coinFamilies={[]}
            onSelectEntry={onSelectEntry}
        />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'DeFi' }));
    return { ...view, onSelectEntry };
}

function defiRows(container) {
    return [...container.querySelectorAll('li > button')];
}

describe('HomeTabs demo DeFi rows', () => {
    it('draws every DeFi row with the shared activity row', () => {
        const { container } = mountDefi();
        const rows = defiRows(container);
        expect(rows).toHaveLength(positions.length);
        for (const row of rows) {
            expect(row.hasAttribute('data-activity-row')).toBe(true);
            expect(row.querySelector('[data-asset-mark]')).not.toBeNull();
        }
    });

    it('shows no confirmation count or unconfirmed text on any row', () => {
        const { container } = mountDefi();
        for (const row of defiRows(container)) {
            for (const node of row.querySelectorAll('*')) {
                expect(node.textContent).not.toMatch(/confirms|unconfirmed/i);
            }
        }
    });

    it('labels each row with the shared status badge', () => {
        const { container } = mountDefi();
        const statuses = defiRows(container).map((row) => row.querySelector('[title]')?.textContent);
        expect(statuses).toEqual(['Confirmed', 'Pending', 'Failed']);
    });

    it('opens the History-shaped entry for the clicked row', () => {
        const { container, onSelectEntry } = mountDefi();
        fireEvent.click(defiRows(container)[1]);
        expect(onSelectEntry).toHaveBeenCalledTimes(1);
        const entry = onSelectEntry.mock.calls[0][0];
        expect(entry).toMatchObject({
            key: 'bitcoin-mainnet|300001:demo-address',
            chainId: 'bitcoin-mainnet',
            address: 'demo-address',
            actionIndex: '300001',
            action: 'DISPENSER',
            blockIndex: 0,
            timestamp: NOW - 120,
            txHash: 'demo-defi-dispenser-pending',
            source: 'demo-address',
            link: null,
        });
        expect(entry.raw).toMatchObject({ id: 'dispenser-pending', status: 'pending' });
    });
});
